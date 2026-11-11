// API HTTP de Bibliorue + service des fichiers statiques. Aucune dépendance externe.
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import {
  hashPassword, verifyPassword, createSession, userFromToken, destroySession, rateLimiter,
} from './auth.js';
import { normalizeIsbn } from '../js/isbn.js';
import { distanceMeters, isValidCoord } from '../js/geo.js';

export const VENUE_KINDS = ['bibliotheque', 'mediatheque', 'librairie', 'cafe', 'association', 'centre_culturel', 'ecole', 'autre'];
const DUPLICATE_RADIUS_M = 15;

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg) => new HttpError(400, msg);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC_FILES = /^\/(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons|fonts)\/[\w.-]+)$/;

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://overpass-api.de https://overpass.private.coffee https://overpass.kumi.systems https://openlibrary.org https://routing.openstreetmap.de https://unpkg.com",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

// ---------- Validation ----------
function str(v, field, { max = 200, required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`Le champ « ${field} » est obligatoire.`);
  if (s.length > max) throw bad(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
}
function url(v) {
  const s = str(v, 'site web', { max: 300 });
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol)) throw 0;
    return u.href;
  } catch { throw bad('Adresse de site web invalide.'); }
}
const now = () => new Date().toISOString();

// ---------- Mise en forme des réponses ----------
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, displayName: u.display_name, accountType: u.account_type,
    venueKind: u.venue_kind ?? null, website: u.website ?? null, role: u.role, createdAt: u.created_at,
  };
}
function boxOut(r) {
  return {
    id: r.id, category: r.category, name: r.name, lat: r.lat, lon: r.lon, address: r.address,
    description: r.description, hours: r.hours, osmId: r.osm_id, createdAt: r.created_at, updatedAt: r.updated_at,
    bookCount: r.book_count ?? 0,
    createdBy: r.created_by ? {
      id: r.created_by, displayName: r.creator_name, accountType: r.creator_type,
      venueKind: r.creator_venue_kind, website: r.creator_website,
    } : null,
  };
}
function bookOut(r) {
  return {
    id: r.id, boxId: r.box_id, status: r.status, title: r.title, authors: r.authors, isbn: r.isbn,
    year: r.year, publisher: r.publisher, coverUrl: r.cover_url, note: r.note,
    addedAt: r.added_at, changedAt: r.changed_at, addedBy: r.added_by ? { id: r.added_by, displayName: r.adder_name } : null,
  };
}
const BOX_SELECT = `
  SELECT b.*, u.display_name AS creator_name, u.account_type AS creator_type,
         u.venue_kind AS creator_venue_kind, u.website AS creator_website,
         (SELECT COUNT(*) FROM books k WHERE k.box_id = b.id AND k.status = 'available') AS book_count
  FROM boxes b LEFT JOIN users u ON u.id = b.created_by`;

// ---------- Application ----------
export function createApp({ db, staticDir, adminEmails = [], trustProxy = false } = {}) {
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const authLimit = rateLimiter({ max: 10, windowMs: 60_000 });
  const writeLimit = rateLimiter({ max: 60, windowMs: 60_000 });

  const log = (type, { userId = null, boxId = null, bookId = null, title = '' }) =>
    db.prepare('INSERT INTO events (type, at, user_id, box_id, book_id, title) VALUES (?, ?, ?, ?, ?, ?)')
      .run(type, now(), userId, boxId, bookId, title);

  const getBox = (id) => db.prepare(`${BOX_SELECT} WHERE b.id = ?`).get(Number(id));
  const canEdit = (user, ownerId) => user && (user.role === 'admin' || user.id === ownerId);

  function findDuplicate(lat, lon, exceptId = 0) {
    const d = 0.0005; // ≈ 55 m : présélection rapide par l'index, puis distance exacte
    const near = db.prepare('SELECT id, name, lat, lon FROM boxes WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND id != ?')
      .all(lat - d, lat + d, lon - d, lon + d, exceptId);
    return near.find((b) => distanceMeters({ lat, lon }, b) < DUPLICATE_RADIUS_M) ?? null;
  }

  // ---------- Routes ----------
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, re, keys, handler, ...opts });
  };

  // Comptes
  route('POST', '/api/auth/register', ({ body, res, ip }) => {
    if (!authLimit(ip)) throw new HttpError(429, 'Trop de tentatives, réessayez dans une minute.');
    const email = str(body.email, 'e-mail', { required: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Adresse e-mail invalide.');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) throw bad('Le mot de passe doit faire au moins 8 caractères.');
    if (password.length > 200) throw bad('Mot de passe trop long.');
    const displayName = str(body.displayName, 'nom affiché', { required: true, max: 80 });
    const accountType = body.accountType === 'culture' ? 'culture' : 'person';
    let venueKind = null; let website = null;
    if (accountType === 'culture') {
      venueKind = VENUE_KINDS.includes(body.venueKind) ? body.venueKind : 'autre';
      website = url(body.website) || null;
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
    const role = admins.has(email) ? 'admin' : 'member';
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (email, display_name, password_hash, account_type, venue_kind, website, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(email, displayName, hashPassword(password), accountType, venueKind, website, role, now());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    setSessionCookie(res, createSession(db, user.id));
    return [201, { user: publicUser(user) }];
  });

  route('POST', '/api/auth/login', ({ body, res, ip }) => {
    if (!authLimit(ip)) throw new HttpError(429, 'Trop de tentatives, réessayez dans une minute.');
    const email = str(body.email, 'e-mail', { required: true }).toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(String(body.password ?? ''), user.password_hash)) {
      throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    }
    setSessionCookie(res, createSession(db, user.id));
    return [200, { user: publicUser(user) }];
  });

  route('POST', '/api/auth/logout', ({ res, token }) => {
    destroySession(db, token);
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return [200, { ok: true }];
  });

  route('GET', '/api/me', ({ user }) => {
    if (!user) return [200, { user: null }];
    const contrib = db.prepare(`SELECT
      (SELECT COUNT(*) FROM boxes WHERE created_by = ?) AS boxes,
      (SELECT COUNT(*) FROM books WHERE added_by = ?) AS books`).get(user.id, user.id);
    return [200, { user: { ...publicUser(user), email: user.email }, contributions: contrib }];
  });

  route('PATCH', '/api/me', ({ user, body }) => {
    const displayName = 'displayName' in body ? str(body.displayName, 'nom affiché', { required: true, max: 80 }) : user.display_name;
    let { venue_kind: venueKind, website } = user;
    if (user.account_type === 'culture') {
      if ('venueKind' in body) venueKind = VENUE_KINDS.includes(body.venueKind) ? body.venueKind : 'autre';
      if ('website' in body) website = url(body.website) || null;
    }
    db.prepare('UPDATE users SET display_name = ?, venue_kind = ?, website = ? WHERE id = ?').run(displayName, venueKind, website, user.id);
    return [200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) }];
  }, { auth: true });

  // Droit à l'effacement (RGPD, art. 17) : le compte et ses sessions sont supprimés ;
  // les boîtes et livres ajoutés restent sur la carte commune, sans auteur.
  route('DELETE', '/api/me', ({ user, body, res }) => {
    if (!verifyPassword(String(body.password ?? ''), user.password_hash)) throw new HttpError(401, 'Mot de passe incorrect.');
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return [200, { ok: true }];
  }, { auth: true });

  // Boîtes
  route('GET', '/api/boxes', ({ query }) => {
    const n = ['south', 'west', 'north', 'east'].map((k) => Number(query.get(k)));
    let rows;
    if (n.every(Number.isFinite)) {
      rows = db.prepare(`${BOX_SELECT} WHERE b.lat BETWEEN ? AND ? AND b.lon BETWEEN ? AND ? LIMIT 2000`).all(n[0], n[2], n[1], n[3]);
    } else {
      rows = db.prepare(`${BOX_SELECT} LIMIT 5000`).all();
    }
    return [200, { boxes: rows.map(boxOut) }];
  });

  route('GET', '/api/boxes/:id', ({ params }) => {
    const box = getBox(params.id);
    if (!box) throw new HttpError(404, 'Boîte introuvable.');
    const books = db.prepare(`SELECT k.*, u.display_name AS adder_name FROM books k LEFT JOIN users u ON u.id = k.added_by
      WHERE k.box_id = ? AND k.status != 'gone' ORDER BY k.changed_at DESC LIMIT 300`).all(box.id);
    return [200, { box: boxOut(box), books: books.map(bookOut) }];
  });

  route('POST', '/api/boxes', ({ user, body }) => {
    const lat = Number(body.lat); const lon = Number(body.lon);
    if (!isValidCoord(lat, lon)) throw bad('Coordonnées invalides.');
    const category = body.category === 'venue' ? 'venue' : 'street';
    if (category === 'venue' && user.account_type !== 'culture' && user.role !== 'admin') {
      throw new HttpError(403, 'Seuls les comptes « lieu culturel » peuvent ajouter un lieu culturel.');
    }
    const osmId = body.osmId ? str(body.osmId, 'osmId', { max: 40 }) : null;
    if (osmId && !/^(node|way|relation)\/\d+$/.test(osmId)) throw bad('Identifiant OSM invalide.');
    if (osmId) {
      const ex = db.prepare('SELECT id FROM boxes WHERE osm_id = ?').get(osmId);
      if (ex) throw new HttpError(409, 'Cette boîte est déjà sur la carte.', { existingId: ex.id });
    }
    const dup = findDuplicate(lat, lon);
    if (dup) throw new HttpError(409, `Une boîte existe déjà à moins de ${DUPLICATE_RADIUS_M} m : « ${dup.name} ».`, { existingId: dup.id });
    const t = now();
    const { lastInsertRowid } = db.prepare(`INSERT INTO boxes (category, name, lat, lon, address, description, hours, osm_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      category, str(body.name, 'nom', { required: true, max: 120 }), lat, lon,
      str(body.address, 'adresse', { max: 200 }), str(body.description, 'description', { max: 1000 }),
      str(body.hours, 'horaires', { max: 200 }), osmId, user.id, t, t);
    log('box_added', { userId: user.id, boxId: Number(lastInsertRowid), title: body.name });
    return [201, { box: boxOut(getBox(lastInsertRowid)) }];
  }, { auth: true });

  route('PATCH', '/api/boxes/:id', ({ user, body, params }) => {
    const box = getBox(params.id);
    if (!box) throw new HttpError(404, 'Boîte introuvable.');
    if (!canEdit(user, box.created_by)) throw new HttpError(403, 'Seul l\'auteur de la boîte ou un modérateur peut la modifier.');
    const name = 'name' in body ? str(body.name, 'nom', { required: true, max: 120 }) : box.name;
    const address = 'address' in body ? str(body.address, 'adresse') : box.address;
    const description = 'description' in body ? str(body.description, 'description', { max: 1000 }) : box.description;
    const hours = 'hours' in body ? str(body.hours, 'horaires') : box.hours;
    db.prepare('UPDATE boxes SET name = ?, address = ?, description = ?, hours = ?, updated_at = ? WHERE id = ?')
      .run(name, address, description, hours, now(), box.id);
    return [200, { box: boxOut(getBox(box.id)) }];
  }, { auth: true });

  route('DELETE', '/api/boxes/:id', ({ user, params }) => {
    const box = getBox(params.id);
    if (!box) throw new HttpError(404, 'Boîte introuvable.');
    if (!canEdit(user, box.created_by)) throw new HttpError(403, 'Seul l\'auteur de la boîte ou un modérateur peut la supprimer.');
    db.prepare('DELETE FROM boxes WHERE id = ?').run(box.id);
    log('box_removed', { userId: user.id, boxId: box.id, title: box.name });
    return [200, { ok: true }];
  }, { auth: true });

  // Livres
  route('POST', '/api/boxes/:id/books', ({ user, body, params }) => {
    const box = getBox(params.id);
    if (!box) throw new HttpError(404, 'Boîte introuvable.');
    const cover = str(body.coverUrl, 'couverture', { max: 400 });
    const t = now();
    const title = str(body.title, 'titre', { required: true, max: 200 });
    const { lastInsertRowid } = db.prepare(`INSERT INTO books (box_id, status, title, authors, isbn, year, publisher, cover_url, note, added_by, added_at, changed_at)
      VALUES (?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      box.id, title, str(body.authors, 'auteurs'), body.isbn ? (normalizeIsbn(body.isbn) ?? '') : '',
      str(body.year, 'année', { max: 30 }), str(body.publisher, 'éditeur'),
      /^https:\/\//.test(cover) ? cover : '', str(body.note, 'remarque', { max: 300 }), user.id, t, t);
    log('book_deposited', { userId: user.id, boxId: box.id, bookId: Number(lastInsertRowid), title });
    return [201, { book: bookOut(db.prepare('SELECT * FROM books WHERE id = ?').get(lastInsertRowid)) }];
  }, { auth: true });

  const changeBook = (type, from, to) => ({ user, params, body }) => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(params.id));
    if (!book) throw new HttpError(404, 'Livre introuvable.');
    if (!from.includes(book.status)) throw new HttpError(409, 'Ce livre a déjà changé d\'état. Rechargez la fiche.');
    let boxId = book.box_id;
    if (type === 'book_deposited' && body.boxId != null) {
      if (!getBox(body.boxId)) throw new HttpError(404, 'Boîte introuvable.');
      boxId = Number(body.boxId);
    }
    db.prepare('UPDATE books SET status = ?, box_id = ?, changed_at = ? WHERE id = ?').run(to, boxId, now(), book.id);
    log(type, { userId: user.id, boxId, bookId: book.id, title: book.title });
    return [200, { book: bookOut(db.prepare('SELECT * FROM books WHERE id = ?').get(book.id)) }];
  };
  route('POST', '/api/books/:id/take', changeBook('book_taken', ['available'], 'taken'), { auth: true });
  route('POST', '/api/books/:id/return', changeBook('book_deposited', ['taken', 'gone'], 'available'), { auth: true });
  route('POST', '/api/books/:id/gone', changeBook('book_gone', ['available'], 'gone'), { auth: true });

  // Recherche, activité, données ouvertes
  route('GET', '/api/search', ({ query }) => {
    const q = str(query.get('q'), 'recherche', { max: 100 });
    if (q.length < 2) return [200, { results: [] }];
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = db.prepare(`SELECT k.*, b.name AS box_name, b.lat, b.lon, b.category FROM books k JOIN boxes b ON b.id = k.box_id
      WHERE k.status = 'available' AND (k.title LIKE ?1 ESCAPE '\\' OR k.authors LIKE ?1 ESCAPE '\\' OR k.isbn LIKE ?1 ESCAPE '\\')
      ORDER BY k.changed_at DESC LIMIT 100`).all(like);
    return [200, { results: rows.map((r) => ({ ...bookOut(r), box: { id: r.box_id, name: r.box_name, lat: r.lat, lon: r.lon, category: r.category } })) }];
  });

  route('GET', '/api/activity', () => {
    const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM boxes WHERE category = 'street') AS street,
      (SELECT COUNT(*) FROM boxes WHERE category = 'venue') AS venues,
      (SELECT COUNT(*) FROM books WHERE status = 'available') AS books,
      (SELECT COUNT(*) FROM users) AS members`).get();
    const events = db.prepare(`SELECT e.type, e.at, e.box_id, e.title, u.display_name AS user_name, u.account_type,
        b.name AS box_name FROM events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN boxes b ON b.id = e.box_id
      ORDER BY e.at DESC, e.id DESC LIMIT 50`).all();
    return [200, { stats, events: events.map((e) => ({
      type: e.type, at: e.at, boxId: e.box_id, boxName: e.box_name, title: e.title,
      user: e.user_name ? { displayName: e.user_name, accountType: e.account_type } : null,
    })) }];
  });

  // Export GeoJSON de la carte (sans données personnelles), pour la réutilisation en données ouvertes.
  route('GET', '/api/export.geojson', () => {
    const rows = db.prepare(BOX_SELECT).all();
    return [200, {
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { id: r.id, category: r.category, name: r.name, address: r.address, description: r.description, hours: r.hours, osm_id: r.osm_id, books_available: r.book_count },
      })),
    }];
  });

  // Signalements et modération
  route('POST', '/api/reports', ({ user, body }) => {
    const targetType = body.targetType === 'book' ? 'book' : 'box';
    const targetId = Number(body.targetId);
    const table = targetType === 'book' ? 'books' : 'boxes';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId)) throw new HttpError(404, 'Élément introuvable.');
    db.prepare('INSERT INTO reports (target_type, target_id, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(targetType, targetId, str(body.reason, 'motif', { required: true, max: 500 }), user.id, now());
    return [201, { ok: true }];
  }, { auth: true });

  route('GET', '/api/admin/reports', () => {
    const rows = db.prepare(`SELECT r.*, u.display_name AS reporter FROM reports r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.resolved = 0 ORDER BY r.created_at DESC LIMIT 200`).all();
    return [200, { reports: rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, reporter: r.reporter, createdAt: r.created_at })) }];
  }, { auth: true, admin: true });

  route('POST', '/api/admin/reports/:id/resolve', ({ params }) => {
    db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(Number(params.id));
    return [200, { ok: true }];
  }, { auth: true, admin: true });

  // ---------- Infrastructure HTTP ----------
  function setSessionCookie(res, { token, maxAge }) {
    const secure = res.req.headers['x-forwarded-proto'] === 'https' || res.req.socket.encrypted ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }

  function send(res, status, data, headers = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  }

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new HttpError(413, 'Requête trop volumineuse.');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { throw bad('JSON invalide.'); }
  }

  async function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    if (!PUBLIC_FILES.test(pathname) || !staticDir) return false;
    const file = normalize(join(staticDir, pathname));
    if (!file.startsWith(normalize(staticDir))) return false;
    try {
      const s = await stat(file);
      if (!s.isFile()) return false;
      const ext = extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' || pathname === '/sw.js' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
      return true;
    } catch { return false; }
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    const u = new URL(req.url, 'http://localhost');
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    try {
      if (!u.pathname.startsWith('/api/')) {
        if ((req.method === 'GET' || req.method === 'HEAD') && await serveStatic(req, res, u.pathname)) return;
        throw new HttpError(404, 'Page introuvable.');
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(u.pathname));
      if (!r) throw new HttpError(404, 'Route inconnue.');
      const mutating = req.method !== 'GET';
      if (mutating) {
        // Protection CSRF : un formulaire d'un autre site ne peut pas envoyer de JSON sans pré-vérification CORS,
        // et l'en-tête Origin, s'il est présent, doit correspondre à ce serveur.
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Content-Type application/json requis.');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origine refusée.');
      }
      const token = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
      const user = userFromToken(db, token);
      if (r.auth && !user) throw new HttpError(401, 'Connectez-vous pour faire cela.');
      if (r.admin && user.role !== 'admin') throw new HttpError(403, 'Réservé aux modérateurs.');
      if (mutating && user && !writeLimit(`u${user.id}`)) throw new HttpError(429, 'Trop d\'actions en peu de temps, patientez un peu.');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, r.re.exec(u.pathname)[i + 1]]));
      const body = mutating ? await readBody(req) : {};
      res.req = req;
      const [status, data] = await r.handler({ req, res, body, params, query: u.searchParams, user, token, ip });
      const extra = u.pathname.endsWith('.geojson') ? { 'Content-Type': 'application/geo+json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } : {};
      send(res, status, data, extra);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
      if (String(err?.message).includes('UNIQUE constraint')) return send(res, 409, { error: 'Cet élément existe déjà.' });
      console.error(err);
      send(res, 500, { error: 'Erreur interne du serveur.' });
    }
  };
}
