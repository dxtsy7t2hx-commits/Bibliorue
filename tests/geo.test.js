import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, formatDistance, isValidCoord } from '../js/geo.js';

test('distance Paris – Lyon ≈ 392 km', () => {
  const d = distanceMeters({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 });
  assert.ok(Math.abs(d - 392000) < 3000, `obtenu ${d}`);
});

test('formatage et validation', () => {
  assert.equal(formatDistance(340.4), '340 m');
  assert.equal(formatDistance(1530), '1,5 km');
  assert.ok(isValidCoord(45, 3));
  assert.ok(!isValidCoord(95, 3));
  assert.ok(!isValidCoord(NaN, 3));
});
