// Recherche bibliographique par ISBN via l'API Books d'Open Library (Internet Archive).
// Internet Archive. (s.d.). Open Library Books API. https://openlibrary.org/dev/docs/api/books

import { normalizeIsbn } from './isbn.js';

export function parseOpenLibrary(json, isbn13) {
  const rec = json?.[`ISBN:${isbn13}`];
  if (!rec) return null;
  return {
    isbn: isbn13,
    title: rec.title + (rec.subtitle ? ` : ${rec.subtitle}` : ''),
    authors: (rec.authors ?? []).map((a) => a.name).join(', '),
    year: rec.publish_date ?? '',
    publisher: (rec.publishers ?? []).map((p) => p.name).join(', '),
    coverUrl: rec.cover?.medium ?? '',
  };
}

export async function lookupIsbn(raw, fetchImpl = fetch) {
  const isbn = normalizeIsbn(raw);
  if (!isbn) throw new Error('ISBN invalide (clé de contrôle incorrecte).');
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Open Library a répondu ${res.status}`);
  return parseOpenLibrary(await res.json(), isbn);
}
