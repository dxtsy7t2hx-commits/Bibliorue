import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server; let base;
before(async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  server = createServer(createApp({ db: openDb(':memory:'), staticDir: root, adminEmails: ['modo@example.org'] }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Petit client qui garde le cookie de session, comme un navigateur.
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}

const alice = client(); const visitor = client(); const biblio = client(); const modo = client();
let boxId; let bookId;

test('fichiers statiques et en-têtes de sécurité', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/server/db.js')).status, 404, 'le code serveur n\'est pas exposé');
  assert.equal((await fetch(base + '/data/bibliorue.db')).status, 404);
  assert.equal((await fetch(base + '/js/../server/auth.js')).status, 404);
});

test('inscription : validations', async () => {
  assert.equal((await visitor('POST', '/api/auth/register', { email: 'x', password: 'abcdefgh', displayName: 'X' })).status, 400);
  assert.equal((await visitor('POST', '/api/auth/register', { email: 'x@y.fr', password: 'court', displayName: 'X' })).status, 400);
  assert.equal((await visitor('POST', '/api/auth/register', { email: 'x@y.fr', password: 'abcdefgh' })).status, 400);
});

test('inscription particulier et lieu culturel', async () => {
  const a = await alice('POST', '/api/auth/register', { email: 'Alice@Example.org', password: 'motdepasse', displayName: 'Alice' });
  assert.equal(a.status, 201);
  assert.equal(a.data.user.accountType, 'person');
  assert.equal(a.data.user.email, undefined, 'e-mail jamais exposé dans le profil public');
  assert.match(a.headers.get('set-cookie'), /HttpOnly/);
  const dup = await client()('POST', '/api/auth/register', { email: 'alice@example.org', password: 'motdepasse', displayName: 'A2' });
  assert.equal(dup.status, 409);

  const b = await biblio('POST', '/api/auth/register', {
    email: 'contact@mediatheque.fr', password: 'motdepasse', displayName: 'Médiathèque du Centre',
    accountType: 'culture', venueKind: 'mediatheque', website: 'mediatheque.fr',
  });
  assert.equal(b.data.user.accountType, 'culture');
  assert.equal(b.data.user.website, 'https://mediatheque.fr/');
  const m = await modo('POST', '/api/auth/register', { email: 'modo@example.org', password: 'motdepasse', displayName: 'Modo' });
  assert.equal(m.data.user.role, 'admin');
});

test('connexion', async () => {
  assert.equal((await client()('POST', '/api/auth/login', { email: 'alice@example.org', password: 'mauvais!' })).status, 401);
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { email: 'ALICE@example.org', password: 'motdepasse' })).status, 200);
  const me = await c('GET', '/api/me');
  assert.equal(me.data.user.displayName, 'Alice');
  await c('POST', '/api/auth/logout', {});
  assert.equal((await c('GET', '/api/me')).data.user, null);
});

test('un visiteur voit la carte mais ne peut pas contribuer', async () => {
  assert.equal((await visitor('GET', '/api/boxes')).status, 200);
  assert.equal((await visitor('POST', '/api/boxes', { name: 'X', lat: 48.85, lon: 2.35 })).status, 401);
});

test('ajout de boîte, catégories et doublons', async () => {
  const r = await alice('POST', '/api/boxes', { name: 'Boîte du square', lat: 48.8566, lon: 2.3522, address: 'Square' });
  assert.equal(r.status, 201);
  assert.equal(r.data.box.category, 'street');
  assert.equal(r.data.box.createdBy.displayName, 'Alice');
  boxId = r.data.box.id;

  const dup = await alice('POST', '/api/boxes', { name: 'Doublon', lat: 48.85665, lon: 2.35222 });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.existingId, boxId);

  const forbidden = await alice('POST', '/api/boxes', { name: 'Faux lieu', lat: 48.86, lon: 2.36, category: 'venue' });
  assert.equal(forbidden.status, 403, 'un particulier ne peut pas créer de lieu culturel');

  const v = await biblio('POST', '/api/boxes', { name: 'Médiathèque du Centre', lat: 48.86, lon: 2.36, category: 'venue', hours: 'Mar–sam 10 h–19 h' });
  assert.equal(v.status, 201);
  assert.equal(v.data.box.category, 'venue');
  assert.equal(v.data.box.createdBy.accountType, 'culture');
  assert.equal(v.data.box.createdBy.venueKind, 'mediatheque');

  const osm = await alice('POST', '/api/boxes', { name: 'OSM', lat: 48.87, lon: 2.37, osmId: 'node/42' });
  assert.equal(osm.status, 201);
  assert.equal((await alice('POST', '/api/boxes', { name: 'OSM bis', lat: 48.88, lon: 2.38, osmId: 'node/42' })).status, 409);

  const inBbox = await visitor('GET', '/api/boxes?south=48.85&west=2.35&north=48.857&east=2.355');
  assert.deepEqual(inBbox.data.boxes.map((b) => b.id), [boxId]);
});

test('droits de modification', async () => {
  assert.equal((await biblio('PATCH', `/api/boxes/${boxId}`, { name: 'Piraté' })).status, 403);
  assert.equal((await alice('PATCH', `/api/boxes/${boxId}`, { description: 'Bleue' })).data.box.description, 'Bleue');
  assert.equal((await modo('PATCH', `/api/boxes/${boxId}`, { hours: '24 h/24' })).status, 200, 'un modérateur peut corriger');
});

test('livres : dépôt, emprunt, redépôt, absence, recherche', async () => {
  const r = await alice('POST', `/api/boxes/${boxId}/books`, { title: 'Les Années', authors: 'Annie Ernaux', isbn: '978-2-07-035419-1', coverUrl: 'javascript:alert(1)' });
  assert.equal(r.status, 201);
  bookId = r.data.book.id;
  assert.equal(r.data.book.coverUrl, '', 'URL dangereuse filtrée');

  assert.equal((await visitor('GET', `/api/boxes/${boxId}`)).data.box.bookCount, 1);
  const found = await visitor('GET', '/api/search?q=ernaux');
  assert.equal(found.data.results[0].box.id, boxId);
  assert.equal((await visitor('GET', '/api/search?q=%25')).data.results.length, 0, 'caractère joker échappé');

  assert.equal((await biblio('POST', `/api/books/${bookId}/take`, {})).status, 200);
  assert.equal((await alice('POST', `/api/books/${bookId}/take`, {})).status, 409, 'déjà pris');
  assert.equal((await visitor('GET', '/api/search?q=ernaux')).data.results.length, 0);
  assert.equal((await biblio('POST', `/api/books/${bookId}/return`, { boxId })).status, 200);
  assert.equal((await alice('POST', `/api/books/${bookId}/gone`, {})).status, 200);
  assert.equal((await visitor('GET', `/api/boxes/${boxId}`)).data.books.length, 0);
});

test('activité, export GeoJSON sans données personnelles', async () => {
  const a = await visitor('GET', '/api/activity');
  assert.equal(a.data.stats.venues, 1);
  assert.equal(a.data.stats.members, 3);
  assert.ok(a.data.events.some((e) => e.type === 'book_taken' && e.user.displayName === 'Médiathèque du Centre'));
  const g = await visitor('GET', '/api/export.geojson');
  assert.equal(g.data.type, 'FeatureCollection');
  assert.ok(!JSON.stringify(g.data).includes('@'), 'aucun e-mail exporté');
});

test('signalements et modération', async () => {
  assert.equal((await alice('POST', '/api/reports', { targetType: 'box', targetId: boxId, reason: 'Test' })).status, 201);
  assert.equal((await alice('GET', '/api/admin/reports')).status, 403);
  const list = await modo('GET', '/api/admin/reports');
  assert.equal(list.data.reports.length, 1);
  await modo('POST', `/api/admin/reports/${list.data.reports[0].id}/resolve`, {});
  assert.equal((await modo('GET', '/api/admin/reports')).data.reports.length, 0);
});

test('protection CSRF', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(res.status, 415);
  const res2 = await alice('POST', '/api/boxes', { name: 'X', lat: 1, lon: 1 }, { origin: 'https://evil.example' });
  assert.equal(res2.status, 403);
});

test('suppression de compte (RGPD) : contributions conservées, anonymisées', async () => {
  assert.equal((await alice('DELETE', '/api/me', { password: 'faux-mdp' })).status, 401);
  assert.equal((await alice('DELETE', '/api/me', { password: 'motdepasse' })).status, 200);
  const box = await visitor('GET', `/api/boxes/${boxId}`);
  assert.equal(box.status, 200);
  assert.equal(box.data.box.createdBy, null);
  assert.equal((await alice('GET', '/api/me')).data.user, null);
});

test('limitation des tentatives de connexion', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 12; i++) last = await c('POST', '/api/auth/login', { email: 'nobody@x.fr', password: 'xxxxxxxx' });
  assert.equal(last.status, 429);
});
