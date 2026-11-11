// Point d'entrée : `npm start`. Configuration par variables d'environnement :
//   PORT            port d'écoute (défaut 8080)
//   DATABASE_PATH   fichier SQLite (défaut ./data/bibliorue.db)
//   ADMIN_EMAILS    e-mails des modérateurs, séparés par des virgules
//   TRUST_PROXY     « 1 » si le serveur est derrière un proxy (Render, Fly.io, Nginx…)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DATABASE_PATH ?? resolve(root, 'data/bibliorue.db'));
const app = createApp({
  db,
  staticDir: root,
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(','),
  trustProxy: process.env.TRUST_PROXY === '1',
});

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 6 * 3600_000).unref();

const port = Number(process.env.PORT ?? 8080);
createServer(app).listen(port, () => console.log(`Bibliorue écoute sur http://localhost:${port}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { db.close(); process.exit(0); });
