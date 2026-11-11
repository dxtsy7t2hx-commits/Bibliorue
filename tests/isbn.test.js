import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIsbn, isValidIsbn10, isValidIsbn13 } from '../js/isbn.js';

test('ISBN-13 valides et invalides', () => {
  assert.ok(isValidIsbn13('9782070360024'));
  assert.ok(!isValidIsbn13('9782070360025'));
});

test('ISBN-10 avec clé X', () => {
  assert.ok(isValidIsbn10('080442957X'));
  assert.ok(!isValidIsbn10('0804429570'));
});

test('normalisation : tirets, espaces, conversion 10 → 13', () => {
  assert.equal(normalizeIsbn('978-2-07-036002-4'), '9782070360024');
  assert.equal(normalizeIsbn('2-07-036002-4'), '9782070360024');
  assert.equal(normalizeIsbn('abc'), null);
});
