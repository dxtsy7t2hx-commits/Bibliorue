// Base de données SQLite (module node:sqlite intégré à Node.js ≥ 22.13, aucune dépendance).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN ('person','culture')),
  venue_kind    TEXT,             -- bibliothèque, librairie, café, association…
  website       TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- « Boîtes » : bibliothèques de rue (street) et lieux culturels (venue).
CREATE TABLE IF NOT EXISTS boxes (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('street','venue')),
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  hours       TEXT NOT NULL DEFAULT '',
  osm_id      TEXT UNIQUE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boxes_geo ON boxes(lat, lon);

CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY,
  box_id     INTEGER NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('available','taken','gone')),
  title      TEXT NOT NULL,
  authors    TEXT NOT NULL DEFAULT '',
  isbn       TEXT NOT NULL DEFAULT '',
  year       TEXT NOT NULL DEFAULT '',
  publisher  TEXT NOT NULL DEFAULT '',
  cover_url  TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS books_box ON books(box_id, status);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  type    TEXT NOT NULL,
  at      TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  box_id  INTEGER,
  book_id INTEGER,
  title   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('box','book')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}
