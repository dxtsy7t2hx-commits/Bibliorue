import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWalk, navigationUrl } from '../js/route.js';
import { distanceMeters } from '../js/geo.js';

const start = { lat: 48.8566, lon: 2.3522 };
// Point à d mètres au nord / à l'est du départ.
const at = (north, east, extra = {}) => ({
  lat: start.lat + north / 111320,
  lon: start.lon + east / (111320 * Math.cos((start.lat * Math.PI) / 180)),
  category: 'street', bookCount: 0, ...extra,
});

test('respecte le budget de temps', () => {
  const boxes = Array.from({ length: 30 }, (_, i) => at(Math.sin(i) * 1500, Math.cos(i * 1.7) * 1500, { id: i }));
  for (const budgetMin of [20, 45, 90]) {
    const p = planWalk(start, boxes, { budgetMin });
    assert.ok(p.totalMin <= budgetMin + 1e-6, `${p.totalMin} > ${budgetMin}`);
    assert.equal(new Set(p.stops.map((s) => s.id)).size, p.stops.length, 'pas de doublon');
  }
});

test('plus de temps → au moins autant d\'étapes', () => {
  const boxes = Array.from({ length: 25 }, (_, i) => at((i % 5) * 400 - 800, Math.floor(i / 5) * 400 - 800, { id: i }));
  const counts = [20, 40, 80, 160].map((b) => planWalk(start, boxes, { budgetMin: b }).stops.length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], counts.join(','));
});

test('ignore les boîtes hors de portée', () => {
  const p = planWalk(start, [at(100, 0, { id: 1 }), at(20000, 0, { id: 2 })], { budgetMin: 30 });
  assert.deepEqual(p.stops.map((s) => s.id), [1]);
});

test('ordre sans croisement sur un carré (2-opt)', () => {
  const sq = [at(300, 300, { id: 'a' }), at(-300, -300, { id: 'c' }), at(300, -300, { id: 'd' }), at(-300, 300, { id: 'b' })];
  const p = planWalk(start, sq, { budgetMin: 120 });
  assert.equal(p.stops.length, 4);
  // Le tour optimal suit le périmètre : deux étapes consécutives sont voisines (≈ 600 m), jamais opposées (≈ 850 m).
  for (let i = 0; i < 3; i++) assert.ok(distanceMeters(p.stops[i], p.stops[i + 1]) < 700);
});

test('préférence pour les boîtes garnies et les lieux culturels', () => {
  const empty = at(300, 0, { id: 'vide' });
  const full = at(-300, 0, { id: 'pleine', bookCount: 20 });
  const p = planWalk(start, [empty, full], { budgetMin: 20, loop: true });
  assert.deepEqual(p.stops.map((s) => s.id), ['pleine']);
});

test('lien de navigation', () => {
  const u = new URL(navigationUrl(start, [at(100, 0), at(200, 0)], true));
  assert.equal(u.searchParams.get('travelmode'), 'walking');
  assert.equal(u.searchParams.get('waypoints').split('|').length, 2);
});
