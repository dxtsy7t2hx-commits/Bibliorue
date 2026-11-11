// Récupération des boîtes à livres réelles recensées dans OpenStreetMap.
// Dans OSM, une boîte à livres est cartographiée avec l'étiquette amenity=public_bookcase
// (OpenStreetMap Wiki contributors. (s.d.). Tag:amenity=public_bookcase.
// https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase).
// L'API Overpass permet d'interroger ces données en lecture seule.

// Serveur principal puis miroirs publics, essayés dans l'ordre si l'un est saturé.
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** bbox = { south, west, north, east } en degrés décimaux. */
export function buildQuery(bbox) {
  const b = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(5)).join(',');
  return `[out:json][timeout:25];(node["amenity"="public_bookcase"](${b});way["amenity"="public_bookcase"](${b}););out center 300;`;
}

/** Convertit la réponse JSON d'Overpass en boîtes au format de l'application. */
export function parseOverpass(json) {
  const out = [];
  for (const el of json?.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = el.tags ?? {};
    const address = [t['addr:housenumber'], t['addr:street'], t['addr:postcode'], t['addr:city']]
      .filter(Boolean).join(' ');
    out.push({
      id: `osm-${el.type}-${el.id}`,
      osmId: `${el.type}/${el.id}`,
      source: 'osm',
      name: t.name || t.operator || 'Boîte à livres',
      lat, lon,
      address,
      description: [t.description, t.opening_hours && `Horaires : ${t.opening_hours}`, t.capacity && `Capacité : ${t.capacity} livres`]
        .filter(Boolean).join(' · '),
    });
  }
  return out;
}

export async function fetchOsmBookcases(bbox, fetchImpl = fetch, urls = OVERPASS_URLS) {
  const body = 'data=' + encodeURIComponent(buildQuery(bbox));
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`Overpass a répondu ${res.status}`);
      return parseOverpass(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Aucun serveur Overpass disponible.');
}
