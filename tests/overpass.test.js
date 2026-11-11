import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, parseOverpass } from '../js/overpass.js';
import { parseOpenLibrary } from '../js/openlibrary.js';

test('requête Overpass ciblant amenity=public_bookcase', () => {
  const q = buildQuery({ south: 45.7, west: 4.8, north: 45.8, east: 4.9 });
  assert.match(q, /amenity"="public_bookcase/);
  assert.match(q, /45\.70000,4\.80000,45\.80000,4\.90000/);
});

test('analyse de la réponse Overpass (nœud et chemin)', () => {
  const boxes = parseOverpass({ elements: [
    { type: 'node', id: 1, lat: 45.75, lon: 4.85, tags: { amenity: 'public_bookcase', name: 'Boîte A', 'addr:street': 'Rue X', 'addr:city': 'Lyon' } },
    { type: 'way', id: 2, center: { lat: 45.76, lon: 4.86 }, tags: { amenity: 'public_bookcase' } },
    { type: 'node', id: 3, tags: {} },
  ] });
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].id, 'osm-node-1');
  assert.equal(boxes[0].address, 'Rue X Lyon');
  assert.equal(boxes[1].name, 'Boîte à livres');
  assert.equal(boxes[1].osmId, 'way/2');
});

test('analyse de la réponse Open Library', () => {
  const r = parseOpenLibrary({ 'ISBN:9782070360024': {
    title: 'L\'étranger', authors: [{ name: 'Albert Camus' }], publish_date: '1972',
    publishers: [{ name: 'Gallimard' }], cover: { medium: 'https://covers.openlibrary.org/b/id/1-M.jpg' },
  } }, '9782070360024');
  assert.equal(r.authors, 'Albert Camus');
  assert.equal(r.publisher, 'Gallimard');
  assert.equal(parseOpenLibrary({}, '9782070360024'), null);
});

test('bascule sur un miroir quand le premier serveur échoue', async () => {
  const { fetchOsmBookcases } = await import('../js/overpass.js');
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url === 'a') return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 9, lat: 1, lon: 2, tags: {} }] }) };
  };
  const boxes = await fetchOsmBookcases({ south: 0, west: 0, north: 1, east: 1 }, fake, ['a', 'b']);
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(boxes.length, 1);
  await assert.rejects(fetchOsmBookcases({ south: 0, west: 0, north: 1, east: 1 }, async () => ({ ok: false, status: 504 }), ['a']), /504/);
});
