import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, STORAGE_KEY } from '../js/store.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('ajout de boîte, dépôt, emprunt, redépôt', () => {
  const s = new Store(memoryStorage());
  const a = s.addBox({ name: 'Square', lat: 48.85, lon: 2.35 });
  const b = s.addBox({ name: 'Gare', lat: 48.88, lon: 2.36 });
  const book = s.addBook(a.id, { title: 'Les Misérables', authors: 'Victor Hugo', isbn: '2-07-036002-4' });
  assert.equal(book.isbn, '9782070360024');
  assert.equal(s.booksInBox(a.id).length, 1);

  s.takeBook(book.id);
  assert.equal(s.booksInBox(a.id).length, 0);
  assert.throws(() => s.takeBook(book.id));

  s.returnBook(book.id, b.id);
  assert.equal(s.booksInBox(b.id).length, 1);
  assert.deepEqual(s.stats(), { boxes: 2, available: 1, taken: 0, events: 5 });
});

test('validations', () => {
  const s = new Store(memoryStorage());
  assert.throws(() => s.addBox({ name: '', lat: 1, lon: 1 }));
  assert.throws(() => s.addBox({ name: 'X', lat: 200, lon: 1 }));
  const box = s.addBox({ name: 'X', lat: 1, lon: 1 });
  assert.throws(() => s.addBook(box.id, { title: '  ' }));
  const bk = s.addBook(box.id, { title: 'T', coverUrl: 'javascript:alert(1)' });
  assert.equal(bk.coverUrl, '');
});

test('recherche insensible aux accents et à la casse', () => {
  const s = new Store(memoryStorage());
  const box = s.addBox({ name: 'X', lat: 1, lon: 1 });
  s.addBook(box.id, { title: 'Éloge de la fuite', authors: 'Henri Laborit' });
  assert.equal(s.searchBooks('eloge').length, 1);
  assert.equal(s.searchBooks('LABORIT').length, 1);
  assert.equal(s.searchBooks('').length, 0);
});

test('persistance, fusion OSM, suppression en cascade', () => {
  const storage = memoryStorage();
  const s = new Store(storage);
  assert.equal(s.mergeOsmBoxes([{ id: 'osm-node-1', osmId: 'node/1', source: 'osm', name: 'OSM', lat: 1, lon: 1 }]), 1);
  assert.equal(s.mergeOsmBoxes([{ id: 'osm-node-1', osmId: 'node/1', source: 'osm', name: 'OSM', lat: 1, lon: 1 }]), 0);
  s.addBook('osm-node-1', { title: 'Livre' });
  const reloaded = new Store(storage);
  assert.equal(reloaded.listBoxes().length, 1);
  assert.equal(reloaded.booksInBox('osm-node-1').length, 1);
  reloaded.removeBox('osm-node-1');
  assert.equal(Object.keys(reloaded.state.books).length, 0);
});

test('export / import et données corrompues', () => {
  const s = new Store(memoryStorage());
  const box = s.addBox({ name: 'X', lat: 1, lon: 1 });
  s.addBook(box.id, { title: 'T' });
  const json = s.exportJson();

  const t = new Store(memoryStorage());
  assert.deepEqual(t.importJson(json), { boxes: 1, books: 1 });
  assert.throws(() => t.importJson('{"version":99}'));

  const bad = memoryStorage();
  bad.setItem(STORAGE_KEY, '{pas du json');
  assert.equal(new Store(bad).listBoxes().length, 0);
});
