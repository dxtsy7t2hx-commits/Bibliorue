// Normalisation et validation des ISBN (International Standard Book Number).
// ISBN-10 : clé de contrôle modulo 11 (le dernier caractère peut valoir « X » = 10).
// ISBN-13 : clé de contrôle modulo 10, pondérations alternées 1 et 3 (norme EAN-13).
// Référence : International ISBN Agency. (2017). ISBN users' manual (7th ed.).

export function cleanIsbn(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export function isbn10to13(isbn10) {
  const core = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}

/** Renvoie l'ISBN-13 normalisé, ou null si la saisie n'est pas un ISBN valide. */
export function normalizeIsbn(raw) {
  const c = cleanIsbn(raw);
  if (c.length === 13 && isValidIsbn13(c)) return c;
  if (c.length === 10 && isValidIsbn10(c)) return isbn10to13(c);
  return null;
}
