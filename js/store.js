// Modèle de données et persistance de Bibliorue.
// Les données restent sur l'appareil (localStorage) : aucune donnée personnelle
// n'est envoyée à un serveur. Un export/import JSON permet sauvegarde et partage.

import { isValidCoord, distanceMeters } from './geo.js';
import { normalizeIsbn } from './isbn.js';

export const STORAGE_KEY = 'bibliorue:v1';
export const SCHEMA_VERSION = 1;

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const now = () => new Date().toISOString();

export function emptyState() {
  return { version: SCHEMA_VERSION, boxes: {}, books: {}, events: [] };
}

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.listeners = new Set();
    this.state = this.#load();
  }

  #load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return validateState(JSON.parse(raw));
    } catch {
      return emptyState();
    }
  }

  #save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* stockage plein ou indisponible : on reste en mémoire */ }
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #log(type, payload) {
    this.state.events.unshift({ id: uid(), type, at: now(), ...payload });
    this.state.events = this.state.events.slice(0, 500);
  }

  // ---------- Boîtes ----------
  listBoxes() {
    return Object.values(this.state.boxes);
  }

  getBox(id) {
    return this.state.boxes[id] ?? null;
  }

  addBox({ name, lat, lon, address = '', description = '' }) {
    lat = Number(lat); lon = Number(lon);
    if (!String(name ?? '').trim()) throw new Error('Le nom est obligatoire.');
    if (!isValidCoord(lat, lon)) throw new Error('Coordonnées invalides.');
    const box = {
      id: uid(), source: 'local', name: name.trim(), lat, lon,
      address: address.trim(), description: description.trim(), createdAt: now(),
    };
    this.state.boxes[box.id] = box;
    this.#log('box_added', { boxId: box.id });
    this.#save();
    return box;
  }

  updateBox(id, patch) {
    const box = this.getBox(id);
    if (!box) throw new Error('Boîte introuvable.');
    const allowed = ['name', 'address', 'description'];
    for (const k of allowed) if (k in patch) box[k] = String(patch[k]).trim();
    if (!box.name) throw new Error('Le nom est obligatoire.');
    this.#save();
    return box;
  }

  removeBox(id) {
    if (!this.state.boxes[id]) return;
    delete this.state.boxes[id];
    for (const b of Object.values(this.state.books)) if (b.boxId === id) delete this.state.books[b.id];
    this.#log('box_removed', { boxId: id });
    this.#save();
  }

  /** Fusionne des boîtes issues d'OpenStreetMap sans écraser celles déjà connues. */
  mergeOsmBoxes(boxes) {
    let added = 0;
    for (const b of boxes) {
      const existing = this.state.boxes[b.id];
      if (existing) {
        Object.assign(existing, { lat: b.lat, lon: b.lon });
      } else {
        this.state.boxes[b.id] = { ...b, createdAt: now() };
        added++;
      }
    }
    if (boxes.length) this.#save();
    return added;
  }

  nearestBoxes(point, limit = Infinity) {
    return this.listBoxes()
      .map((b) => ({ ...b, distance: distanceMeters(point, b) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  // ---------- Livres ----------
  booksInBox(boxId, { includeTaken = false } = {}) {
    return Object.values(this.state.books)
      .filter((b) => b.boxId === boxId && (includeTaken || b.status === 'available'))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  addBook(boxId, { title, authors = '', isbn = '', year = '', publisher = '', coverUrl = '', note = '' }) {
    if (!this.getBox(boxId)) throw new Error('Boîte introuvable.');
    if (!String(title ?? '').trim()) throw new Error('Le titre est obligatoire.');
    const book = {
      id: uid(), boxId, status: 'available',
      title: title.trim(), authors: authors.trim(),
      isbn: isbn ? (normalizeIsbn(isbn) ?? '') : '',
      year: String(year).trim(), publisher: publisher.trim(),
      coverUrl: /^https:\/\//.test(coverUrl) ? coverUrl : '',
      note: note.trim(), addedAt: now(), takenAt: null,
    };
    this.state.books[book.id] = book;
    this.#log('book_deposited', { boxId, bookId: book.id, title: book.title });
    this.#save();
    return book;
  }

  takeBook(bookId) {
    const b = this.state.books[bookId];
    if (!b || b.status !== 'available') throw new Error('Livre indisponible.');
    b.status = 'taken';
    b.takenAt = now();
    this.#log('book_taken', { boxId: b.boxId, bookId, title: b.title });
    this.#save();
    return b;
  }

  /** Re-dépose un livre (éventuellement dans une autre boîte). */
  returnBook(bookId, boxId) {
    const b = this.state.books[bookId];
    if (!b) throw new Error('Livre introuvable.');
    if (!this.getBox(boxId)) throw new Error('Boîte introuvable.');
    b.status = 'available';
    b.boxId = boxId;
    b.takenAt = null;
    b.addedAt = now();
    this.#log('book_deposited', { boxId, bookId, title: b.title });
    this.#save();
    return b;
  }

  removeBook(bookId) {
    if (!this.state.books[bookId]) return;
    delete this.state.books[bookId];
    this.#save();
  }

  /** Recherche plein texte (titre, auteurs, ISBN), insensible à la casse et aux accents. */
  searchBooks(query, { includeTaken = false } = {}) {
    const q = fold(query);
    if (!q) return [];
    return Object.values(this.state.books).filter(
      (b) => (includeTaken || b.status === 'available') &&
        fold(`${b.title} ${b.authors} ${b.isbn}`).includes(q),
    );
  }

  stats() {
    const books = Object.values(this.state.books);
    return {
      boxes: this.listBoxes().length,
      available: books.filter((b) => b.status === 'available').length,
      taken: books.filter((b) => b.status === 'taken').length,
      events: this.state.events.length,
    };
  }

  // ---------- Sauvegarde ----------
  exportJson() {
    return JSON.stringify({ ...this.state, exportedAt: now(), app: 'Bibliorue' }, null, 2);
  }

  importJson(text, { merge = true } = {}) {
    const incoming = validateState(JSON.parse(text));
    if (merge) {
      Object.assign(this.state.boxes, incoming.boxes);
      Object.assign(this.state.books, incoming.books);
      const seen = new Set(this.state.events.map((e) => e.id));
      this.state.events = [...this.state.events, ...incoming.events.filter((e) => !seen.has(e.id))]
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
    } else {
      this.state = incoming;
    }
    this.#save();
    return { boxes: Object.keys(incoming.boxes).length, books: Object.keys(incoming.books).length };
  }

  reset() {
    this.state = emptyState();
    this.#save();
  }
}

export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Valide et assainit un état chargé (stockage local ou fichier importé). */
export function validateState(data) {
  if (!data || typeof data !== 'object') throw new Error('Fichier invalide.');
  if (data.version !== SCHEMA_VERSION) throw new Error(`Version de données non prise en charge : ${data.version}`);
  const state = emptyState();
  const str = (v) => (typeof v === 'string' ? v : '');
  for (const [id, b] of Object.entries(data.boxes ?? {})) {
    if (!b || !isValidCoord(Number(b.lat), Number(b.lon)) || !str(b.name)) continue;
    state.boxes[id] = {
      id, source: b.source === 'osm' ? 'osm' : 'local', osmId: str(b.osmId) || undefined,
      name: str(b.name), lat: Number(b.lat), lon: Number(b.lon),
      address: str(b.address), description: str(b.description), createdAt: str(b.createdAt) || now(),
    };
  }
  for (const [id, b] of Object.entries(data.books ?? {})) {
    if (!b || !state.boxes[b.boxId] || !str(b.title)) continue;
    state.books[id] = {
      id, boxId: b.boxId, status: b.status === 'taken' ? 'taken' : 'available',
      title: str(b.title), authors: str(b.authors), isbn: str(b.isbn), year: str(b.year),
      publisher: str(b.publisher), coverUrl: /^https:\/\//.test(str(b.coverUrl)) ? b.coverUrl : '',
      note: str(b.note), addedAt: str(b.addedAt) || now(), takenAt: str(b.takenAt) || null,
    };
  }
  state.events = (Array.isArray(data.events) ? data.events : [])
    .filter((e) => e && str(e.id) && str(e.type) && str(e.at))
    .map((e) => ({ id: e.id, type: e.type, at: e.at, boxId: str(e.boxId), bookId: str(e.bookId), title: str(e.title) }));
  return state;
}
