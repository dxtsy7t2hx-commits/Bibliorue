// Tests de bout en bout de la base Supabase :
//   vraie bibliothèque supabase-js  →  faux Supabase (tests/fake-supabase.mjs)  →  PostgreSQL
// avec le script de migration réel. Nécessite un PostgreSQL accessible (variables PGHOST,
// PGPORT, PGUSER) ; sinon les tests sont ignorés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { psql, startFakeSupabase } from './fake-supabase.mjs';
import { createApi } from '../js/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(root, 'supabase/migrations/20261111120000_bibliorue.sql');
const DB = 'bibliorue_test_' + process.pid;

let available = true;
try { await psql('postgres', 'select 1'); } catch { available = false; }
const t = available ? test : test.skip;

// supabase-js (version UMD, identique à celle du navigateur) chargé dans Node.
const supabaseLib = vm.runInThisContext(readFileSync(join(root, 'vendor/supabase-js-2.118.0.js'), 'utf8') + '\n;supabase');

let fake;
const KEY = 'cle-publique-de-test-suffisamment-longue';
const newApi = () => createApi(supabaseLib.createClient(fake.url, KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { redirectUrl: () => 'https://exemple.test/' });

before(async () => {
  if (!available) return;
  await psql('postgres', `drop database if exists ${DB}`);
  await psql('postgres', `create database ${DB}`);
  await psql(DB, readFileSync(join(root, 'tests/supabase-sim.sql'), 'utf8'));
  await psql(DB, readFileSync(MIGRATION, 'utf8'));
  await psql(DB, readFileSync(MIGRATION, 'utf8')); // le script doit pouvoir être relancé sans erreur
  fake = await startFakeSupabase({ db: DB });
});
after(async () => {
  if (!available) return;
  fake.close();
  await psql('postgres', `drop database if exists ${DB} with (force)`);
});

const visitor = () => newApi();
let alice; let media; let modo;
let boxId; let bookId;

t('inscription : particulier, lieu culturel, validations', async () => {
  alice = newApi();
  const a = await alice.register({ email: 'alice@example.org', password: 'motdepasse', displayName: 'Alice', accountType: 'person' });
  assert.equal(a.needsConfirmation, false);
  assert.equal(a.user.displayName, 'Alice');
  assert.equal(a.user.accountType, 'person');
  assert.equal(a.user.role, 'member');

  media = newApi();
  const m = await media.register({ email: 'contact@media.fr', password: 'motdepasse', displayName: 'Médiathèque du Centre', accountType: 'culture', venueKind: 'mediatheque', website: 'media.fr' });
  assert.equal(m.user.accountType, 'culture');
  assert.equal(m.user.venueKind, 'mediatheque');
  assert.equal(m.user.website, 'https://media.fr');

  await assert.rejects(newApi().register({ email: 'alice@example.org', password: 'motdepasse', displayName: 'A2' }), /existe déjà/);
  await assert.rejects(newApi().register({ email: 'x@y.fr', password: 'court', displayName: 'X' }), /8 caractères/);
});

t('connexion, profil, déconnexion', async () => {
  const c = newApi();
  await assert.rejects(c.login({ email: 'alice@example.org', password: 'mauvais-mdp' }), /incorrect/);
  const me = await c.login({ email: 'alice@example.org', password: 'motdepasse' });
  assert.equal(me.user.email, 'alice@example.org');
  assert.equal(me.contributions.boxes, 0);
  await c.logout();
  assert.equal((await c.me()).user, null);
});

t('un visiteur lit la carte mais ne peut rien écrire', async () => {
  const v = visitor();
  assert.deepEqual((await v.boxes()).boxes, []);
  await assert.rejects(v.addBox({ name: 'X', lat: 48.85, lon: 2.35 }), /Connectez-vous/);
  await assert.rejects(v.report('box', 1, 'x'), /Connectez-vous/);
});

t('accès direct aux tables refusé (RLS)', async () => {
  const c = supabaseLib.createClient(fake.url, KEY, { auth: { persistSession: false } });
  // Simulation de ce que ferait un client malveillant avec PostgREST : écriture directe en SQL sous le rôle anon/authenticated.
  await assert.rejects(psql(DB, `begin; set local role authenticated; insert into public.boxes (category, name, lat, lon) values ('venue', 'pirate', 1, 1); commit;`), /permission denied|row-level security/);
  await assert.rejects(psql(DB, `begin; set local role anon; update public.profiles set role = 'admin'; commit;`), /permission denied/);
  await assert.rejects(psql(DB, `begin; set local role authenticated; select * from public.reports; commit;`), /permission denied/);
  await assert.rejects(psql(DB, `begin; set local role anon; select public.make_admin('alice@example.org'); commit;`), /permission denied/);
  assert.ok(c);
});

t('ajout de boîtes : catégories, doublons, OSM', async () => {
  const r = await alice.addBox({ name: 'Boîte du square', lat: 48.8566, lon: 2.3522, address: 'Square' });
  assert.equal(r.box.category, 'street');
  assert.equal(r.box.createdBy.displayName, 'Alice');
  boxId = r.box.id;

  await assert.rejects(alice.addBox({ name: 'Doublon', lat: 48.85665, lon: 2.35222 }), (e) => e.data.existingId === boxId && /15 m/.test(e.message));
  await assert.rejects(alice.addBox({ name: 'Faux lieu', lat: 48.86, lon: 2.36, category: 'venue' }), /lieu culturel/);

  const v = await media.addBox({ name: 'Médiathèque du Centre', lat: 48.86, lon: 2.36, category: 'venue', hours: 'Mar–sam 10 h–19 h' });
  assert.equal(v.box.category, 'venue');
  assert.equal(v.box.createdBy.accountType, 'culture');

  await alice.addBox({ name: 'OSM', lat: 48.87, lon: 2.37, osmId: 'node/42' });
  await assert.rejects(alice.addBox({ name: 'OSM bis', lat: 48.88, lon: 2.38, osmId: 'node/42' }), (e) => e.data.existingId > 0);
  await assert.rejects(alice.addBox({ name: 'X', lat: 95, lon: 2 }), /Coordonnées/);

  const inBox = await visitor().boxes({ south: 48.85, west: 2.35, north: 48.857, east: 2.355 });
  assert.deepEqual(inBox.boxes.map((b) => b.id), [boxId]);
});

t('droits de modification et modérateur', async () => {
  await assert.rejects(media.updateBox(boxId, { name: 'Piraté' }), /auteur/);
  assert.equal((await alice.updateBox(boxId, { description: 'Bleue' })).box.description, 'Bleue');

  modo = newApi();
  await modo.register({ email: 'modo@example.org', password: 'motdepasse', displayName: 'Modo' });
  assert.match(await psql(DB, `select public.make_admin('MODO@example.org')`), /modérateur/);
  assert.equal((await modo.me()).user.role, 'admin');
  assert.equal((await modo.updateBox(boxId, { hours: '24 h/24' })).box.hours, '24 h/24');
});

t('livres : dépôt, emprunt, redépôt, absence, recherche', async () => {
  const r = await alice.addBook(boxId, { title: 'Les Années', authors: 'Annie Ernaux', isbn: '978-2-07-035419-1', coverUrl: 'javascript:alert(1)' });
  bookId = r.book.id;
  assert.equal(r.book.isbn, '9782070354191');
  assert.equal(r.book.coverUrl, '', 'URL dangereuse filtrée');

  assert.equal((await visitor().box(boxId)).box.bookCount, 1);
  const found = await visitor().search('ernaux');
  assert.equal(found.results[0].box.id, boxId);
  assert.equal((await visitor().search('%')).results.length, 0, 'joker échappé');
  assert.equal((await visitor().search('e')).results.length, 0, '2 caractères minimum');

  await media.takeBook(bookId);
  await assert.rejects(alice.takeBook(bookId), /déjà changé/);
  assert.equal((await visitor().search('ernaux')).results.length, 0);
  await media.returnBook(bookId, boxId);
  await alice.goneBook(bookId);
  assert.equal((await visitor().box(boxId)).books.length, 0);
});

t('communauté et export GeoJSON sans données personnelles', async () => {
  const a = await visitor().activity();
  assert.equal(a.stats.venues, 1);
  assert.equal(a.stats.members, 3);
  assert.ok(a.events.some((e) => e.type === 'book_taken' && e.user.displayName === 'Médiathèque du Centre'));
  const g = await visitor().exportGeojson();
  assert.equal(g.type, 'FeatureCollection');
  assert.equal(g.features.length, 3);
  assert.ok(!JSON.stringify(g).includes('@'));
});

t('signalements et modération', async () => {
  await alice.report('box', boxId, 'Test');
  await assert.rejects(alice.reports(), /modérateurs/);
  const { reports } = await modo.reports();
  assert.equal(reports.length, 1);
  await modo.resolveReport(reports[0].id);
  assert.equal((await modo.reports()).reports.length, 0);
  const backup = await modo.backup();
  assert.equal(backup.boxes.length, 3);
  assert.ok(!JSON.stringify(backup).includes('@'), 'aucun e-mail dans la sauvegarde');
  await assert.rejects(alice.backup(), /modérateurs/);
});

t('limite de 60 actions par minute', async () => {
  const spam = newApi();
  await spam.register({ email: 'spam@example.org', password: 'motdepasse', displayName: 'Spam' });
  const { box } = await spam.addBox({ name: 'Spam', lat: 10, lon: 10 });
  let err = null;
  for (let i = 0; i < 70 && !err; i++) await spam.addBook(box.id, { title: `Livre ${i}` }).catch((e) => { err = e; });
  assert.match(err?.message ?? '', /Trop d'actions/);
});

t('suppression de compte (RGPD) : contributions conservées sans nom', async () => {
  await assert.rejects(alice.deleteMe('faux-mot-de-passe'), /incorrect/);
  await alice.deleteMe('motdepasse');
  const b = await visitor().box(boxId);
  assert.equal(b.box.createdBy, null);
  await assert.rejects(newApi().login({ email: 'alice@example.org', password: 'motdepasse' }), /incorrect/);
});
