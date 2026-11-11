// Conseiller de balade : choisir et ordonner des boîtes à visiter dans un temps donné.
//
// Le problème est un « problème d'orientation » (orienteering problem) : maximiser l'intérêt
// des étapes visitées sous contrainte de durée. Il est NP-difficile (Golden, B. L., Levy, L.,
// & Vohra, R. (1987). The orienteering problem. Naval Research Logistics, 34(3), 307–318.
// https://doi.org/10.1002/1520-6750(198706)34:3<307::AID-NAV3220340302>3.0.CO;2-D).
// On utilise donc une heuristique classique :
//   1. insertion la moins coûteuse, en privilégiant le meilleur rapport intérêt / temps ajouté ;
//   2. amélioration « 2-opt » de l'ordre de visite (Croes, G. A. (1958). A method for solving
//      traveling-salesman problems. Operations Research, 6(6), 791–812.
//      https://doi.org/10.1287/opre.6.6.791) ;
//   3. nouvelle tentative d'insertion avec le temps libéré.
// Les distances sont à vol d'oiseau, multipliées par un facteur de détour (≈ 1,3 en ville,
// ordre de grandeur usuel du rapport distance réseau / distance euclidienne) ; l'itinéraire
// piéton réel est ensuite demandé à OSRM.

import { distanceMeters } from './geo.js';

export const DEFAULTS = { budgetMin: 60, speedKmh: 4.5, detour: 1.3, stopMin: 5, loop: true, maxStops: 15 };

export function defaultWeight(box) {
  const books = Math.min(box.bookCount ?? 0, 20) / 20; // 0 à 1 selon le nombre de livres signalés
  return (box.category === 'venue' ? 1.2 : 1) + books;
}

export function planWalk(start, candidates, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const weight = o.weight ?? defaultWeight;
  const minutes = (a, b) => (distanceMeters(a, b) * o.detour) / ((o.speedKmh * 1000) / 60);

  // Pré-filtre : étapes atteignables seules dans le budget.
  let pool = candidates.filter((c) => minutes(start, c) * (o.loop ? 2 : 1) + o.stopMin <= o.budgetMin);
  const route = []; // étapes ordonnées (sans le départ)

  const pathCost = (r) => {
    let t = 0; let prev = start;
    for (const s of r) { t += minutes(prev, s) + o.stopMin; prev = s; }
    if (o.loop && r.length) t += minutes(prev, start);
    return t;
  };

  const insertGreedy = () => {
    let current = pathCost(route);
    for (;;) {
      if (route.length >= o.maxStops || !pool.length) return;
      let best = null;
      for (const c of pool) {
        for (let i = 0; i <= route.length; i++) {
          const prev = i === 0 ? start : route[i - 1];
          const next = i < route.length ? route[i] : (o.loop ? start : null);
          const added = minutes(prev, c) + o.stopMin + (next ? minutes(c, next) - minutes(prev, next) : 0);
          if (current + added > o.budgetMin + 1e-9) continue;
          const score = weight(c) / Math.max(added, 0.1);
          if (!best || score > best.score) best = { c, i, added, score };
        }
      }
      if (!best) return;
      route.splice(best.i, 0, best.c);
      pool = pool.filter((p) => p !== best.c);
      current += best.added;
    }
  };

  const twoOpt = () => {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < route.length - 1; i++) {
        for (let j = i + 1; j < route.length; j++) {
          const candidate = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
          if (pathCost(candidate) + 1e-9 < pathCost(route)) { route.splice(0, route.length, ...candidate); improved = true; }
        }
      }
    }
  };

  insertGreedy();
  twoOpt();
  insertGreedy();
  twoOpt();

  const walkMin = pathCost(route) - route.length * o.stopMin;
  return {
    stops: route,
    walkMin,
    totalMin: walkMin + route.length * o.stopMin,
    distanceM: (walkMin * o.speedKmh * 1000) / 60,
  };
}

// Itinéraire piéton réel via OSRM (Luxen, D., & Vetter, C. (2011). Real-time routing with
// OpenStreetMap data. ACM SIGSPATIAL GIS '11, 513–516. https://doi.org/10.1145/2093973.2094062),
// serveur public de la FOSSGIS e.V.
export const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export async function fetchWalkingRoute(points, fetchImpl = fetch) {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetchImpl(`${OSRM_FOOT}/${coords}?overview=full&geometries=geojson&steps=false`);
  if (!res.ok) throw new Error(`OSRM a répondu ${res.status}`);
  const json = await res.json();
  const r = json.routes?.[0];
  if (!r) throw new Error('Aucun itinéraire trouvé.');
  return {
    latlngs: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distanceM: r.distance,
    walkMin: r.duration / 60,
  };
}

/** Lien d'ouverture dans une application de navigation (Google Maps accepte jusqu'à 9 étapes intermédiaires). */
export function navigationUrl(start, stops, loop) {
  const pts = stops.map((s) => `${s.lat},${s.lon}`);
  const destination = loop ? `${start.lat},${start.lon}` : pts.pop();
  const p = new URLSearchParams({ api: '1', origin: `${start.lat},${start.lon}`, destination, travelmode: 'walking' });
  if (pts.length) p.set('waypoints', pts.slice(0, 9).join('|'));
  return `https://www.google.com/maps/dir/?${p}`;
}
