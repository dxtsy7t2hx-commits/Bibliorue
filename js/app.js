// Interface de Bibliorue (v3) : carte immersive + feuille coulissante, fiches plein écran,
// balade en étapes, inscription en étapes, accueil à faire glisser.
import { api, ApiError, isConfigured } from './api.js';
import { fetchOsmBookcases } from './overpass.js';
import { lookupIsbn } from './openlibrary.js';
import { distanceMeters, formatDistance, isValidCoord } from './geo.js';
import { planWalk, fetchWalkingRoute, navigationUrl } from './route.js';

const DEFAULT_VIEW = { lat: 46.6, lon: 2.4, zoom: 6 }; // France métropolitaine
// Couleurs des marqueurs (identiques à css/style.css)
const COLORS = { street: '#1f46c6', venue: '#b0472c', osm: '#1f46c6', me: '#1f46c6', paper: '#f8f3ea', ink: '#18204a' };
const VENUE_LABEL = {
  bibliotheque: 'Bibliothèque', mediatheque: 'Médiathèque', librairie: 'Librairie', cafe: 'Café-livres',
  association: 'Association', centre_culturel: 'Centre culturel', ecole: 'École / université', autre: 'Lieu culturel',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pi = (name, cls = '') => `<svg class="pi ${cls}" aria-hidden="true"><use href="#pi-${name}"/></svg>`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMin = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
const venueLabel = (b) => VENUE_LABEL[b.createdBy?.venueKind] ?? 'Lieu culturel';
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

const state = {
  me: null,
  boxes: new Map(),   // boîtes Bibliorue chargées (id → boîte)
  osm: new Map(),     // boîtes OSM pas encore importées
  showOsm: false,
  filter: 'all',      // all | street | venue | books
  userPos: null,
  currentBox: null,
  picking: false,
  pickDefaults: null,
};

// ---------- Utilitaires d'interface ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
function setMsg(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
}
function requireLogin(reason) {
  if (state.me) return true;
  toast(`Connectez-vous ou créez un compte pour ${reason}.`);
  closeDialogs();
  showView('view-account');
  return false;
}
function closeDialogs() { $$('dialog[open]').forEach((d) => d.close()); }
const errMsg = (err) => (err instanceof ApiError ? err.message : `Problème de connexion (${err.message}).`);

// Couverture « dessinée » quand le livre n'a pas d'image : couleur stable selon le titre.
function coverHtml(b) {
  if (b.coverUrl) return `<div class="cover"><img src="${esc(b.coverUrl)}" alt="" loading="lazy"></div>`;
  let h = 0;
  for (const c of String(b.title)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<div class="cover c${h % 5}">${pi('book')}<div><div class="ct">${esc(b.title)}</div><div class="ca">${esc(b.authors || '')}</div></div></div>`;
}

// ---------- Navigation (avec View Transitions quand le navigateur les gère) ----------
function showView(id) {
  const apply = () => {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
    document.body.dataset.screen = id;
    if (id !== 'view-map') window.scrollTo(0, 0);
  };
  const current = $('.view.active')?.id;
  if (current !== id && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(apply);
  } else apply();
  if (id === 'view-map') setTimeout(() => map.invalidateSize(), 50);
  if (id === 'view-community') renderCommunity();
  if (id === 'view-account') renderAccount();
  if (!/access_token|error_description|type=/.test(location.hash)) history.replaceState(null, '', `#${id.replace('view-', '')}`);
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#btn-account').addEventListener('click', () => showView('view-account'));
$('.brand').addEventListener('click', (e) => { e.preventDefault(); showView('view-map'); });

// ---------- Accueil (première visite) ----------
const onboarding = $('#onboarding');
const obTrack = $('#ob-track');
function obIndex() { return Math.round(obTrack.scrollLeft / obTrack.clientWidth); }
function obUpdate() {
  const i = obIndex();
  onboarding.dataset.slide = String(i);
  $$('#ob-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  $('#ob-next').firstChild.textContent = i === 2 ? 'Commencer ' : 'Suivant ';
}
function obClose() {
  onboarding.hidden = true;
  storage.set('bibliorue:onboarded', '1');
}
function obOpen() {
  onboarding.hidden = false;
  obTrack.scrollLeft = 0;
  obUpdate();
}
obTrack.addEventListener('scroll', () => requestAnimationFrame(obUpdate), { passive: true });
$('#ob-next').addEventListener('click', () => {
  const i = obIndex();
  if (i >= 2) return obClose();
  obTrack.scrollTo({ left: (i + 1) * obTrack.clientWidth, behavior: 'smooth' });
});
$('#ob-skip').addEventListener('click', obClose);
$('#btn-replay-intro').addEventListener('click', obOpen);

// ---------- Carte ----------
const map = L.map('map', { zoomControl: false }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
}).addTo(map);
const boxLayer = L.layerGroup().addTo(map);
const osmLayer = L.layerGroup().addTo(map);
const walkLayer = L.layerGroup().addTo(map);
let meMarker = null;

// Marqueurs : pastilles carrées arrondies, pictogramme en réserve.
function stampIcon({ fill, glyph, glyphColor, outline = false, size = 40 }) {
  const r = Math.round(size * 0.32);
  const g = Math.round(size * 0.6);
  const off = (size - g) / 2;
  return L.divIcon({
    className: 'marker',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="filter:drop-shadow(0 4px 6px rgb(24 32 74 / .35))">
      <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${r}" fill="${fill}" stroke="${outline ? COLORS.osm : COLORS.paper}" stroke-width="${outline ? 2.5 : 3}" ${outline ? 'stroke-dasharray="5 3"' : ''}/>
      <use href="#pi-${glyph}" x="${off}" y="${off - 1}" width="${g}" height="${g}" style="color:${glyphColor}"/></svg>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}
const ICONS = {
  street: stampIcon({ fill: COLORS.street, glyph: 'box', glyphColor: COLORS.paper }),
  venue: stampIcon({ fill: COLORS.venue, glyph: 'venue', glyphColor: COLORS.paper, size: 46 }),
  osm: stampIcon({ fill: COLORS.paper, glyph: 'box', glyphColor: COLORS.osm, outline: true, size: 34 }),
  me: L.divIcon({
    className: 'marker',
    html: `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13" fill="${COLORS.me}" fill-opacity=".22"/><circle cx="15" cy="15" r="7" fill="${COLORS.me}" stroke="${COLORS.paper}" stroke-width="3"/></svg>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  }),
};

const matchesFilter = (b) => state.filter === 'all'
  || (state.filter === 'street' && b.category === 'street')
  || (state.filter === 'venue' && b.category === 'venue')
  || (state.filter === 'books' && b.bookCount > 0);

function renderMarkers() {
  boxLayer.clearLayers();
  for (const box of state.boxes.values()) {
    if (!matchesFilter(box)) continue;
    L.marker([box.lat, box.lon], { icon: ICONS[box.category], title: box.name, zIndexOffset: box.category === 'venue' ? 500 : 0 })
      .on('click', () => openBox(box.id)).addTo(boxLayer);
  }
  osmLayer.clearLayers();
  if (!state.showOsm) return;
  const known = new Set([...state.boxes.values()].map((b) => b.osmId).filter(Boolean));
  for (const o of state.osm.values()) {
    if (known.has(o.osmId)) continue;
    L.marker([o.lat, o.lon], { icon: ICONS.osm, title: o.name }).bindPopup(() => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${esc(o.name)}</strong><br><span class="small">Recensée dans OpenStreetMap,<br>pas encore sur Bibliorue.</span><br>`;
      const btn = document.createElement('button');
      btn.className = 'pill solid';
      btn.textContent = 'L\'ajouter à Bibliorue';
      btn.onclick = () => {
        if (!requireLogin('ajouter une boîte')) return;
        map.closePopup();
        openBoxForm({ name: o.name === 'Boîte à livres' ? '' : o.name, lat: o.lat, lon: o.lon, address: o.address, description: o.description, osmId: o.osmId });
      };
      div.append(btn);
      return div;
    }).addTo(osmLayer);
  }
}

function referencePoint() {
  return state.userPos ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };
}

function boxCardHtml(b) {
  const venue = b.category === 'venue';
  return `<li><button class="box-card ${venue ? 'venue' : ''}" data-box="${b.id}" type="button">
    <svg class="bc-illu big-pi" aria-hidden="true"><use href="#pi-${venue ? 'venue' : 'box'}"/></svg>
    <span class="bc-text"><strong>${esc(b.name)}</strong>
      <span class="meta">${venue ? esc(venueLabel(b)) : `${b.bookCount} livre${b.bookCount > 1 ? 's' : ''}`}${b.address ? ' · ' + esc(b.address) : ''}</span></span>
    <span class="bc-dist">${formatDistance(b.distance)}</span>
  </button></li>`;
}

function renderBoxList() {
  const ref = referencePoint();
  const all = [...state.boxes.values()].filter(matchesFilter)
    .map((b) => ({ ...b, distance: distanceMeters(ref, b) }))
    .sort((a, b) => a.distance - b.distance);
  const near = all.filter((b) => b.distance < 3000).length;
  $('#near-count').textContent = all.length ? `${near} à moins de 3 km` : 'À deux pas';
  const ul = $('#box-list');
  if (!all.length) {
    ul.innerHTML = `<li class="rail-empty"><span class="tile">${pi('box')}</span><p>Aucune boîte par ici pour l'instant. Ajoutez celles que vous connaissez avec le bouton +, ou affichez les « Boîtes OSM ».</p></li>`;
    return;
  }
  ul.innerHTML = all.slice(0, 30).map(boxCardHtml).join('');
}
for (const sel of ['#box-list', '#search-results', '#walk-result']) {
  $(sel).addEventListener('click', (e) => {
    const id = e.target.closest('[data-box]')?.dataset.box;
    if (id) openBox(Number(id));
  });
}

// Filtres de la carte
$$('.map-chips [data-filter]').forEach((c) => c.addEventListener('click', () => {
  state.filter = c.dataset.filter;
  $$('.map-chips [data-filter]').forEach((x) => x.classList.toggle('on', x === c));
  renderMarkers(); renderBoxList();
}));

// Chargement des boîtes visibles (élargi à 50 % autour de la vue), avec anti-rebond.
let loadTimer;
async function loadBoxes() {
  const b = map.getBounds().pad(0.5);
  try {
    const { boxes } = await api.boxes({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    for (const box of boxes) state.boxes.set(box.id, box);
    renderMarkers();
    renderBoxList();
  } catch (err) {
    toast(`Impossible de charger la carte : ${errMsg(err)}`);
  }
}
map.on('moveend', () => {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => { if (state.picking) return; loadBoxes(); if (state.showOsm) loadOsm(); }, 300);
});

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('géolocalisation non disponible'));
    navigator.geolocation.getCurrentPosition((p) => {
      state.userPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (meMarker) meMarker.remove();
      meMarker = L.marker([state.userPos.lat, state.userPos.lon], { icon: ICONS.me, zIndexOffset: 2000, keyboard: false })
        .addTo(map).bindTooltip('Vous êtes ici');
      resolve(state.userPos);
    }, (err) => reject(new Error(err.message)), { enableHighAccuracy: true, timeout: 10000 });
  });
}
$('#btn-locate').addEventListener('click', async () => {
  try {
    const pos = await locate();
    map.flyTo([pos.lat, pos.lon], 15, { duration: 0.8 });
  } catch (err) { toast(`Position indisponible : ${err.message}`); }
});

// Boîtes recensées dans OpenStreetMap, proposées à l'import.
let osmBusy = false;
async function loadOsm() {
  if (osmBusy) return;
  if (map.getZoom() < 12) { toast('Zoomez sur un quartier ou une ville pour voir les boîtes OSM.'); return; }
  const b = map.getBounds();
  osmBusy = true;
  try {
    const found = await fetchOsmBookcases({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    for (const o of found) state.osm.set(o.osmId, o);
    renderMarkers();
  } catch (err) {
    toast(`OpenStreetMap ne répond pas : ${err.message}`);
  } finally { osmBusy = false; }
}
$('#btn-osm').addEventListener('click', (e) => {
  state.showOsm = !state.showOsm;
  e.currentTarget.setAttribute('aria-pressed', String(state.showOsm));
  if (state.showOsm) loadOsm(); else renderMarkers();
});

// ---------- Feuille coulissante : trois états (mini / peek / open) ----------
// Téléphone : on tire la poignée (haut = agrandir, bas = réduire jusqu'à la simple barre de titre).
// Grand écran : panneau latéral, replié en pastille d'un toucher. Le choix est mémorisé.
const sheet = $('#sheet');
const wide = matchMedia('(min-width: 900px)');
function setSheet(s, remember = true) {
  if (wide.matches && s === 'peek') s = 'open';
  sheet.dataset.state = s;
  $('#view-map').dataset.sheet = s;
  const label = wide.matches
    ? (s === 'mini' ? 'Déplier la liste' : 'Replier la liste')
    : (s === 'open' ? 'Réduire la liste' : 'Agrandir la liste');
  $('#sheet-toggle').setAttribute('aria-label', label);
  if (remember) storage.set(wide.matches ? 'bibliorue:panel' : 'bibliorue:sheet', s);
}
function sheetUp() { setSheet(sheet.dataset.state === 'mini' ? (wide.matches ? 'open' : 'peek') : 'open'); }
function sheetDown() { setSheet(sheet.dataset.state === 'open' && !wide.matches ? 'peek' : 'mini'); }
$('#sheet-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  if (wide.matches) setSheet(sheet.dataset.state === 'mini' ? 'open' : 'mini');
  else setSheet(sheet.dataset.state === 'open' ? 'peek' : 'open');
});
$('.sheet-head').addEventListener('click', () => { if (sheet.dataset.state === 'mini') sheetUp(); });
{
  let startY = null;
  const grip = $('#sheet-grip');
  grip.addEventListener('pointerdown', (e) => { startY = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (Math.abs(dy) < 8) return sheet.dataset.state === 'open' ? setSheet('peek') : sheetUp();
    if (dy < 0) sheetUp(); else sheetDown();
  });
}
function initSheet() {
  const saved = storage.get(wide.matches ? 'bibliorue:panel' : 'bibliorue:sheet');
  setSheet(['mini', 'peek', 'open'].includes(saved) ? saved : (wide.matches ? 'open' : 'peek'), false);
}
wide.addEventListener('change', initSheet);
initSheet();

// ---------- Placer une boîte : repère fixe au centre, on déplace la carte ----------
function setPicking(on) {
  state.picking = on;
  document.body.classList.toggle('picking', on);
  $('#pick-ui').hidden = !on;
  if (on) { closeDialogs(); setSheet('mini', false); if (map.getZoom() < 16) map.setZoom(Math.max(map.getZoom(), 16)); }
  else initSheet();
}
$('#btn-add-box').addEventListener('click', () => {
  if (!requireLogin('ajouter une boîte')) return;
  setPicking(true);
});
$('#btn-cancel-pick').addEventListener('click', () => { setPicking(false); state.pickDefaults = null; });
$('#btn-confirm-pick').addEventListener('click', () => {
  const c = map.getCenter();
  setPicking(false);
  openBoxForm({ lat: c.lat, lon: c.lng, ...state.pickDefaults });
  state.pickDefaults = null;
});

// ---------- Formulaire boîte ----------
function openBoxForm(box = {}) {
  const f = $('#boxform');
  f.reset();
  for (const k of ['id', 'osmId', 'name', 'address', 'description', 'hours']) f[k].value = box[k] ?? '';
  f.lat.value = Number.isFinite(box.lat) ? box.lat.toFixed(6) : '';
  f.lon.value = Number.isFinite(box.lon) ? box.lon.toFixed(6) : '';
  f.lat.readOnly = f.lon.readOnly = Boolean(box.id);
  const canVenue = !box.id && (state.me?.accountType === 'culture' || state.me?.role === 'admin');
  $('#category-field').hidden = !canVenue;
  f.querySelector(`[name=category][value=${box.category === 'venue' ? 'venue' : 'street'}]`).checked = true;
  $('#boxform-title').textContent = box.id ? 'Modifier' : box.category === 'venue' ? 'Mon lieu culturel' : 'Nouvelle boîte';
  setMsg($('#boxform-msg'), box.osmId ? 'Importée depuis OpenStreetMap : vérifiez et complétez.' : '');
  $('#boxform-dialog').showModal();
}
$('#boxform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const data = Object.fromEntries(new FormData(f));
  const lat = Number(String(data.lat).replace(',', '.'));
  const lon = Number(String(data.lon).replace(',', '.'));
  if (!isValidCoord(lat, lon)) return setMsg($('#boxform-msg'), 'Coordonnées invalides.', true);
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    let box;
    if (data.id) {
      ({ box } = await api.updateBox(data.id, { name: data.name, address: data.address, description: data.description, hours: data.hours }));
      toast('Modifications enregistrées.');
    } else {
      ({ box } = await api.addBox({ ...data, lat, lon, category: data.category ?? 'street', osmId: data.osmId || undefined }));
      toast(box.category === 'venue' ? 'Votre lieu est sur la carte !' : 'Merci ! La boîte est maintenant visible par tous.');
    }
    state.boxes.set(box.id, box);
    renderMarkers(); renderBoxList();
    $('#boxform-dialog').close();
    openBox(box.id);
  } catch (err) {
    setMsg($('#boxform-msg'), errMsg(err), true);
    if (err.data?.existingId) {
      const link = document.createElement('button');
      link.type = 'button'; link.className = 'pill'; link.textContent = 'Voir la boîte existante';
      link.onclick = () => { $('#boxform-dialog').close(); openBox(err.data.existingId); };
      $('#boxform-msg').append(' ', link);
    }
  } finally { btn.disabled = false; }
});

// ---------- Fiche boîte ----------
function bookCardHtml(b) {
  const actions = b.status === 'available'
    ? `<button class="go" data-act="take" data-id="${b.id}" type="button">Je le prends</button>
       <button data-act="gone" data-id="${b.id}" type="button">N'y est plus</button>
       <button data-act="report-book" data-id="${b.id}" type="button" aria-label="Signaler ce livre">${pi('flag')}</button>`
    : `<button class="go" data-act="return" data-id="${b.id}" type="button">Je le redépose ici</button>`;
  const when = b.status === 'taken' ? `emprunté le ${fmtDate(b.changedAt)}` : `${fmtDate(b.changedAt)}${b.addedBy ? ` · ${esc(b.addedBy.displayName)}` : ''}`;
  return `<li><div class="book-card ${b.status}">${coverHtml(b)}
    <div class="bk-meta"><strong>${esc(b.title)}</strong>${b.authors ? `<br>${esc(b.authors)}` : ''}${b.note ? `<br>« ${esc(b.note)} »` : ''}<br>${when}</div>
    <div class="bk-actions">${actions}</div></div></li>`;
}

function renderBox({ box, books }) {
  const venue = box.category === 'venue';
  const hero = $('#box-hero');
  hero.classList.toggle('venue', venue);
  $('#box-illu-use').setAttribute('href', `#pi-${venue ? 'venue' : 'box'}`);
  const dist = state.userPos ? distanceMeters(state.userPos, box) : null;
  $('#box-eyebrow').textContent = `${venue ? venueLabel(box) : 'Bibliothèque de rue'}${dist != null ? ` · à ${formatDistance(dist)}` : ''}`;
  $('#box-title').textContent = box.name;

  const available = books.filter((b) => b.status === 'available');
  const taken = books.filter((b) => b.status === 'taken');
  const mine = state.me && (state.me.id === box.createdBy?.id || state.me.role === 'admin');
  const route = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${state.userPos ? `${state.userPos.lat},${state.userPos.lon}` : ''};${box.lat},${box.lon}`;
  const c = box.createdBy;
  const creator = !c ? 'Ajoutée par un ancien membre'
    : c.accountType === 'culture'
      ? `<span class="creator venue">Ajoutée par <strong>${esc(c.displayName)}</strong> (${esc(VENUE_LABEL[c.venueKind] ?? 'lieu culturel')})${c.website ? ` · <a href="${esc(c.website)}" target="_blank" rel="noopener nofollow">site web</a>` : ''}</span>`
      : `Ajoutée par <strong>${esc(c.displayName)}</strong>`;

  $('#box-body').innerHTML = `
    <div class="facts">
      <span class="fact big">${pi('books')}${available.length} livre${available.length > 1 ? 's' : ''}</span>
      ${box.address ? `<span class="fact">${pi('locate')}${esc(box.address)}</span>` : ''}
      ${box.hours ? `<span class="fact">${pi('clock')}${esc(box.hours)}</span>` : ''}
    </div>
    ${box.description ? `<p class="desc">${esc(box.description)}</p>` : ''}
    <div class="panel-actions">
      <a class="pill solid" href="${route}" target="_blank" rel="noopener">${pi('nav')}Y aller</a>
      <a class="pill" href="${esc(navigationUrl(state.userPos ?? box, [box], false))}" target="_blank" rel="noopener">${pi('pin')}Appli GPS</a>
    </div>
    <div class="shelf-head"><h3>Sur l'étagère</h3><span>${available.length}</span></div>
    ${available.length
      ? `<ul class="shelf">${available.map(bookCardHtml).join('')}</ul>`
      : `<div class="shelf-empty">${pi('books')}<p>Aucun livre signalé pour l'instant. Vous y êtes ? Dites-nous ce que vous voyez.</p></div>`}
    ${taken.length ? `<div class="shelf-head"><h3>Récemment empruntés</h3><span>${taken.length}</span></div><ul class="shelf">${taken.map(bookCardHtml).join('')}</ul>` : ''}
    <p class="creator">${creator} · ${fmtDate(box.createdAt)}</p>
    <div class="panel-foot">
      ${box.osmId ? `<a class="link" href="https://www.openstreetmap.org/${esc(box.osmId)}" target="_blank" rel="noopener">Voir sur OSM</a>` : ''}
      ${mine ? `<button class="link" data-act="edit" type="button">${pi('pencil')}Modifier</button><button class="link danger" data-act="delete" type="button">${pi('trash')}Supprimer</button>` : ''}
      <button class="link" data-act="report-box" type="button">${pi('flag')}Signaler</button>
    </div>`;
}

async function openBox(id) {
  map.closePopup();
  try {
    const data = await api.box(id);
    state.currentBox = data.box;
    state.boxes.set(data.box.id, data.box);
    renderBox(data);
    $('#book-form').reset();
    setMsg($('#book-msg'), '');
    $('#add-book').open = false;
    const d = $('#box-dialog');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  } catch (err) { toast(errMsg(err)); }
}
async function reloadBox() {
  if (!state.currentBox) return;
  const data = await api.box(state.currentBox.id);
  state.currentBox = data.box;
  state.boxes.set(data.box.id, data.box);
  renderBox(data);
  renderMarkers(); renderBoxList();
}

$('#box-dialog').addEventListener('close', stopScan);
$('#box-body').addEventListener('click', async (e) => {
  const t = e.target.closest('button[data-act]');
  if (!t) return;
  const id = Number(t.dataset.id);
  const box = state.currentBox;
  try {
    switch (t.dataset.act) {
      case 'take':
        if (!requireLogin('indiquer que vous prenez un livre')) return;
        await api.takeBook(id); toast('Bonne lecture !'); break;
      case 'return':
        if (!requireLogin('redéposer un livre')) return;
        await api.returnBook(id, box.id); toast('Merci pour le dépôt !'); break;
      case 'gone':
        if (!requireLogin('mettre à jour la boîte')) return;
        if (!confirm('Ce livre n\'est plus dans la boîte ?')) return;
        await api.goneBook(id); toast('Merci, la liste est à jour.'); break;
      case 'report-book':
      case 'report-box': {
        if (!requireLogin('signaler un contenu')) return;
        const reason = prompt('Pourquoi signalez-vous ce contenu ? (boîte inexistante, doublon, contenu inapproprié…)');
        if (!reason?.trim()) return;
        await api.report(t.dataset.act === 'report-book' ? 'book' : 'box', t.dataset.act === 'report-book' ? id : box.id, reason);
        toast('Signalement transmis aux modérateurs. Merci.');
        return;
      }
      case 'edit':
        $('#box-dialog').close(); openBoxForm(box); return;
      case 'delete':
        if (!confirm('Supprimer cette boîte et ses livres pour tout le monde ?')) return;
        await api.deleteBox(box.id);
        state.boxes.delete(box.id);
        $('#box-dialog').close(); renderMarkers(); renderBoxList();
        toast('Boîte supprimée.');
        return;
    }
    await reloadBox();
  } catch (err) {
    toast(errMsg(err));
    reloadBox().catch(() => {});
  }
});

// ---------- Dépôt d'un livre ----------
const bookForm = $('#book-form');
$('#add-book').addEventListener('toggle', (e) => {
  if (e.currentTarget.open && !state.me) { e.currentTarget.open = false; requireLogin('signaler un livre'); return; }
  if (e.currentTarget.open) setTimeout(() => bookForm.isbn.focus(), 100);
});

async function fillFromIsbn() {
  const isbn = bookForm.isbn.value;
  if (!isbn.trim()) return setMsg($('#book-msg'), 'Saisissez d\'abord un ISBN.', true);
  setMsg($('#book-msg'), 'Recherche dans Open Library…');
  try {
    const info = await lookupIsbn(isbn);
    if (!info) return setMsg($('#book-msg'), 'ISBN valide mais inconnu d\'Open Library : complétez à la main.', true);
    for (const k of ['title', 'authors', 'year', 'publisher', 'coverUrl']) bookForm[k].value = info[k] ?? '';
    bookForm.isbn.value = info.isbn;
    setMsg($('#book-msg'), 'Fiche complétée. Vérifiez puis enregistrez.');
  } catch (err) { setMsg($('#book-msg'), err.message, true); }
}
$('#btn-isbn').addEventListener('click', fillFromIsbn);

bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.addBook(state.currentBox.id, Object.fromEntries(new FormData(bookForm)));
    bookForm.reset();
    setMsg($('#book-msg'), '');
    $('#add-book').open = false;
    toast('Livre ajouté. Merci !');
    await reloadBox();
  } catch (err) { setMsg($('#book-msg'), errMsg(err), true); }
});

// Lecture du code-barres EAN-13 (= ISBN-13) avec l'API BarcodeDetector, quand le navigateur la propose.
let scanStream = null;
if ('BarcodeDetector' in window) $('#btn-scan').hidden = false;
async function startScan() {
  const video = $('#scan-video');
  try {
    const detector = new BarcodeDetector({ formats: ['ean_13'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream;
    video.hidden = false;
    await video.play();
    setMsg($('#book-msg'), 'Visez le code-barres au dos du livre…');
    const loop = async () => {
      if (!scanStream) return;
      const codes = await detector.detect(video).catch(() => []);
      const isbn = codes.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v));
      if (isbn) { stopScan(); bookForm.isbn.value = isbn; fillFromIsbn(); } else requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    stopScan();
    setMsg($('#book-msg'), `Caméra indisponible : ${err.message}`, true);
  }
}
function stopScan() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  $('#scan-video').hidden = true;
}
$('#btn-scan').addEventListener('click', () => (scanStream ? stopScan() : startScan()));

// ---------- Balade ----------
function stopWalk(silent = false) {
  walkLayer.clearLayers();
  $('#walk-result').innerHTML = '';
  $('#walk-banner').hidden = true;
  if (!silent) toast('Balade arrêtée.');
}
$('#btn-stop-walk').addEventListener('click', () => stopWalk());
function stepMarker(n, color) {
  return L.divIcon({ className: '', html: `<span class="marker-num" style="background:${color}">${n}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] });
}

$('#walk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const out = $('#walk-result');
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  out.innerHTML = '<p class="msg">Calcul de la balade…</p>';
  try {
    let start;
    if (f.start.value === 'gps') {
      try { start = await locate(); } catch (err) {
        start = referencePoint();
        toast(`Position indisponible (${err.message}) : départ au centre de la carte.`);
      }
    } else start = { lat: map.getCenter().lat, lon: map.getCenter().lng };

    const budgetMin = Number(f.budget.value);
    // Rayon utile : la moitié de la distance faisable dans le temps imparti.
    const radiusM = (budgetMin / 60) * 4500 / (f.loop.checked ? 2 : 1);
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.cos((start.lat * Math.PI) / 180));
    const { boxes } = await api.boxes({ south: start.lat - dLat, north: start.lat + dLat, west: start.lon - dLon, east: start.lon + dLon });
    for (const b of boxes) state.boxes.set(b.id, b);
    const candidates = boxes.filter((b) => (f.venues.checked || b.category !== 'venue') && (!f.withBooks.checked || b.bookCount > 0 || b.category === 'venue'));
    const plan = planWalk(start, candidates, { budgetMin, loop: f.loop.checked });

    stopWalk(true);
    if (!plan.stops.length) {
      out.innerHTML = `<div class="shelf-empty">${pi('walk')}<p>Aucune boîte accessible en ${fmtMin(budgetMin)} depuis ce point (${candidates.length} dans la zone). Essayez plus de temps, un autre départ… ou ajoutez les boîtes que vous connaissez !</p></div>`;
      return;
    }

    // Tracé piéton réel (OSRM), à défaut lignes droites.
    const pts = [start, ...plan.stops, ...(f.loop.checked ? [start] : [])];
    let real = null;
    try { real = await fetchWalkingRoute(pts); } catch { /* repli sur l'estimation */ }
    L.polyline(real?.latlngs ?? pts.map((p) => [p.lat, p.lon]), { color: COLORS.venue, weight: 5, opacity: 0.9, dashArray: real ? '1 10' : '6 8', lineCap: 'round' }).addTo(walkLayer);
    L.marker([start.lat, start.lon], { icon: ICONS.me, zIndexOffset: 1500 }).bindTooltip('Départ').addTo(walkLayer);
    plan.stops.forEach((s, i) => L.marker([s.lat, s.lon], { icon: stepMarker(i + 1, COLORS[s.category]), zIndexOffset: 1000 })
      .bindTooltip(`${i + 1}. ${esc(s.name)}`).on('click', () => openBox(s.id)).addTo(walkLayer));

    const walkMin = real?.walkMin ?? plan.walkMin;
    const distM = real?.distanceM ?? plan.distanceM;
    const totalMin = walkMin + plan.stops.length * 5;
    const venues = plan.stops.filter((s) => s.category === 'venue').length;
    const n = plan.stops.length;
    out.innerHTML = `
      <div class="walk-card s-brick grain">
        <svg class="wc-illu big-pi" aria-hidden="true"><use href="#pi-walk"/></svg>
        <p class="eyebrow">Votre balade</p>
        <p class="poster">${n} étape${n > 1 ? 's' : ''}</p>
        <div class="facts-row">
          <span>${formatDistance(distM)} à pied</span>
          <span>${fmtMin(totalMin)} avec les arrêts</span>
          ${venues ? `<span>${venues} lieu${venues > 1 ? 'x' : ''} culturel${venues > 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      ${real ? '' : '<p class="small">Tracé réel indisponible : distances estimées à vol d\'oiseau × 1,3.</p>'}
      ${totalMin > budgetMin * 1.15 ? '<p class="small">Le trajet réel dépasse un peu le temps prévu (détours du réseau piéton).</p>' : ''}
      <ol class="timeline">
        <li><span class="step-dot home">${pi('locate')}</span><span class="tl-home">Départ</span></li>
        ${plan.stops.map((s, i) => `<li><span class="step-dot ${s.category}">${i + 1}</span><button class="tl-card" type="button" data-box="${s.id}">
          <strong>${esc(s.name)}</strong><span class="meta">${s.category === 'venue' ? esc(venueLabel(s)) : `${s.bookCount} livre${s.bookCount > 1 ? 's' : ''}`}${s.hours ? ' · ' + esc(s.hours) : ''}</span></button></li>`).join('')}
        ${f.loop.checked ? `<li><span class="step-dot home">${pi('locate')}</span><span class="tl-home">Retour au départ</span></li>` : ''}
      </ol>
      <div class="panel-actions">
        <button type="button" class="pill solid" id="btn-walk-map">${pi('box')}Voir sur la carte</button>
        <a class="pill" target="_blank" rel="noopener" href="${esc(navigationUrl(start, plan.stops, f.loop.checked))}">${pi('nav')}Appli GPS</a>
      </div>
      <button type="button" class="pill xl walk-stop" id="btn-stop-walk-2">${pi('close')}Arrêter cette balade</button>
      <p class="small">Itinéraire calculé avec OSRM sur les données OpenStreetMap. Vérifiez les horaires des lieux culturels.</p>`;
    $('#btn-stop-walk-2').onclick = () => stopWalk();
    $('#walk-banner-text').textContent = `Balade : ${n} étape${n > 1 ? 's' : ''} · ${formatDistance(distM)}`;
    $('#walk-banner').hidden = false;
    $('#btn-walk-map').onclick = () => {
      showView('view-map');
      setSheet('mini', false);
      setTimeout(() => map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.25)), 80);
    };
    renderMarkers();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    out.innerHTML = `<p class="msg error">${esc(errMsg(err))}</p>`;
  } finally { btn.disabled = false; }
});

// ---------- Recherche ----------
let searchTimer;
async function runSearch() {
  const q = $('#search-input').value.trim();
  const ul = $('#search-results');
  $('#search-suggest').hidden = q.length >= 2;
  if (q.length < 2) { ul.innerHTML = ''; return; }
  try {
    const { results } = await api.search(q);
    const ref = referencePoint();
    results.sort((a, b) => distanceMeters(ref, a.box) - distanceMeters(ref, b.box));
    ul.innerHTML = results.length ? results.map((b) => `<li><button class="book-card" data-box="${b.box.id}" type="button">
      ${coverHtml(b)}
      <span class="bk-meta"><strong>${esc(b.title)}</strong>${b.authors ? `<br>${esc(b.authors)}` : ''}<br>${esc(b.box.name)} · ${formatDistance(distanceMeters(ref, b.box))}</span>
      </button></li>`).join('')
      : `<li class="empty-state"><div class="shelf-empty">${pi('search')}<p>Ce livre n'est signalé dans aucune boîte pour le moment.</p></div></li>`;
  } catch (err) { ul.innerHTML = `<li class="empty-state msg error">${esc(errMsg(err))}</li>`; }
}
$('#search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
$$('#search-suggest [data-q]').forEach((c) => c.addEventListener('click', () => { $('#search-input').value = c.dataset.q; runSearch(); }));

// ---------- Communauté ----------
const EVENT_LABEL = { book_deposited: 'a déposé', book_taken: 'a pris', book_gone: 'a signalé l\'absence de', box_added: 'a ajouté', box_removed: 'a retiré' };
const EVENT_ICON = { book_deposited: 'book', book_taken: 'books', book_gone: 'flag', box_added: 'box', box_removed: 'trash' };
async function renderCommunity() {
  try {
    const { stats, events } = await api.activity();
    $('#stats').innerHTML = `
      <div class="tile-stat wide s-blue grain reveal"><svg class="ts-illu big-pi" aria-hidden="true"><use href="#pi-box"/></svg><b>${stats.street}</b><span>bibliothèques de rue</span></div>
      <div class="tile-stat s-brick grain reveal"><svg class="ts-illu big-pi" aria-hidden="true"><use href="#pi-venue"/></svg><b>${stats.venues}</b><span>lieux culturels</span></div>
      <div class="tile-stat outline reveal"><b>${stats.books}</b><span>livres signalés</span></div>
      <div class="tile-stat wide s-paper reveal"><svg class="ts-illu big-pi" aria-hidden="true"><use href="#pi-people"/></svg><b>${stats.members}</b><span>membres</span></div>`;
    $('#events').innerHTML = events.length ? events.map((e) => {
      const venue = e.user?.accountType === 'culture';
      const who = e.user ? `<strong${venue ? ' style="color:var(--brick)"' : ''}>${esc(e.user.displayName)}</strong>` : 'Quelqu\'un';
      const what = e.type.startsWith('box') ? `la boîte « ${esc(e.title)} »` : `« ${esc(e.title)} »${e.boxName ? ` — ${esc(e.boxName)}` : ''}`;
      return `<li class="reveal"><span class="fd-icon ${venue ? 'venue' : ''}">${pi(EVENT_ICON[e.type] ?? 'book')}</span><div>
        <time datetime="${esc(e.at)}">${new Date(e.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
        <p>${who} ${EVENT_LABEL[e.type] ?? esc(e.type)} ${what}</p></div></li>`;
    }).join('') : `<li><span class="fd-icon">${pi('book')}</span><p>Pas encore de contributions. Lancez-vous !</p></li>`;
  } catch (err) { $('#events').innerHTML = `<li class="msg error">${esc(errMsg(err))}</li>`; }
}

// ---------- Compte ----------
function setAuthTab(which) {
  $$('[data-auth]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === which)));
  $('#login-form').hidden = which !== 'login';
  $('#register-form').hidden = which !== 'register';
  if (which === 'register') setRegStep(1);
}
$$('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.auth)));

// Inscription en trois étapes
const regForm = $('#register-form');
let regStep = 1;
function setRegStep(n) {
  regStep = n;
  $$('.reg-step', regForm).forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  $('#reg-count').textContent = String(n).padStart(2, '0');
  $('#reg-ring').style.strokeDasharray = `${Math.round((n / 3) * 100)} 100`;
  $('#reg-back').hidden = n === 1;
  $('#reg-next').hidden = n === 3;
  $('#reg-submit').hidden = n !== 3;
  setMsg(regForm.querySelector('.msg'), '');
  const culture = regForm.accountType.value === 'culture';
  $('#venue-fields').hidden = !culture;
  $('#name-label').textContent = culture ? 'Nom du lieu' : 'Nom affiché (pseudonyme possible)';
  $('#name-legend').textContent = culture ? 'Votre lieu' : 'Votre nom sur la carte';
  const first = $(`.reg-step[data-step="${n}"] input:not([type=radio])`, regForm);
  if (first && n > 1) setTimeout(() => first.focus(), 50);
}
function validStep(n) {
  const fields = $$(`.reg-step[data-step="${n}"] input, .reg-step[data-step="${n}"] select`, regForm).filter((i) => i.offsetParent !== null);
  for (const i of fields) if (!i.reportValidity()) return false;
  return true;
}
$('#reg-next').addEventListener('click', () => { if (validStep(regStep)) setRegStep(regStep + 1); });
$('#reg-back').addEventListener('click', () => setRegStep(regStep - 1));
regForm.addEventListener('change', (e) => { if (e.target.name === 'accountType') setRegStep(regStep); });
regForm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && regStep < 3 && e.target.tagName === 'INPUT') { e.preventDefault(); $('#reg-next').click(); }
});

function updateHeader() {
  const b = $('#btn-account');
  const culture = state.me?.accountType === 'culture';
  b.innerHTML = state.me
    ? `<span class="initial">${esc(state.me.displayName.trim().charAt(0).toUpperCase())}</span>`
    : pi('user');
  b.classList.toggle('venue', culture);
  b.setAttribute('aria-label', state.me ? `Mon compte (${state.me.displayName})` : 'Se connecter');
}

async function afterLogin(user, welcome) {
  state.me = user;
  updateHeader();
  toast(welcome);
  await renderAccount();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    const { user } = await api.login(Object.fromEntries(new FormData(f)));
    f.reset();
    await afterLogin(user, `Bon retour, ${user.displayName} !`);
    showView('view-map');
  } catch (err) { setMsg(f.querySelector('.msg'), errMsg(err), true); }
});

regForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validStep(3)) return;
  try {
    const data = Object.fromEntries(new FormData(regForm));
    const { user, needsConfirmation } = await api.register(data);
    regForm.reset();
    setRegStep(1);
    if (needsConfirmation) {
      setRegStep(3);
      setMsg(regForm.querySelector('.msg'), `Presque fini ! Un e-mail de confirmation vient d'être envoyé à ${data.email}. Cliquez sur le lien qu'il contient : vous serez connecté automatiquement. (Pensez à regarder dans les indésirables.)`);
      return;
    }
    await afterLogin(user, `Bienvenue sur Bibliorue, ${user.displayName} !`);
  } catch (err) { setMsg(regForm.querySelector('.msg'), errMsg(err), true); }
});

// Mot de passe oublié : envoi d'un lien par e-mail, puis saisie du nouveau mot de passe au retour.
$('#btn-forgot').addEventListener('click', async () => {
  const f = $('#login-form');
  const email = f.email.value.trim() || prompt('Votre adresse e-mail :')?.trim();
  if (!email) return;
  try {
    await api.resetPassword(email);
    setMsg(f.querySelector('.msg'), `Si un compte existe pour ${email}, un lien de réinitialisation vient d'être envoyé.`);
  } catch (err) { setMsg(f.querySelector('.msg'), errMsg(err), true); }
});

api.onAuthChange(async (event) => {
  if (event === 'PASSWORD_RECOVERY') {
    showView('view-account');
    for (let i = 0; i < 3; i++) {
      const pwd = prompt('Choisissez votre nouveau mot de passe (8 caractères minimum) :');
      if (!pwd) break;
      try { await api.updatePassword(pwd); toast('Mot de passe modifié. Vous êtes connecté.'); break; } catch (err) { alert(errMsg(err)); }
    }
  }
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
    try {
      const wasIn = Boolean(state.me);
      const { user } = await api.me();
      state.me = user;
      updateHeader();
      if (!wasIn && user && /type=(signup|magiclink|email)/.test(location.hash)) {
        toast(`Adresse confirmée. Bienvenue, ${user.displayName} !`);
        history.replaceState(null, '', location.pathname + '#account');
        showView('view-account');
      }
      if ($('#view-account').classList.contains('active')) renderAccount();
    } catch { /* hors ligne */ }
  }
});

async function renderAccount() {
  $('#account-out').hidden = Boolean(state.me);
  $('#account-in').hidden = !state.me;
  if (!state.me) return;
  try {
    const { user, contributions } = await api.me();
    if (!user) { state.me = null; updateHeader(); return renderAccount(); }
    state.me = user;
    const culture = user.accountType === 'culture';
    $('#profile-hero').classList.toggle('venue', culture);
    $('#me-initial').textContent = user.displayName.trim().charAt(0).toUpperCase();
    $('#me-name').textContent = user.displayName;
    $('#me-type').innerHTML = `${culture
      ? `<span class="badge">${pi('venue')}${esc(VENUE_LABEL[user.venueKind] ?? 'Lieu culturel')}</span>`
      : `<span class="badge">${pi('user')}Particulier</span>`}
      ${user.role === 'admin' ? `<span class="badge">${pi('flag')}Modérateur</span>` : ''}
      <br><span class="small" style="color:inherit;opacity:.8">${esc(user.email)} · membre depuis le ${fmtDate(user.createdAt)}</span>
      ${culture && user.website ? `<br><a href="${esc(user.website)}" target="_blank" rel="noopener">${esc(user.website)}</a>` : ''}`;
    $('#me-stats').innerHTML = `
      <div class="tile-stat s-paper"><b>${contributions.boxes}</b><span>boîte${contributions.boxes > 1 ? 's' : ''} ajoutée${contributions.boxes > 1 ? 's' : ''}</span></div>
      <div class="tile-stat outline"><b>${contributions.books}</b><span>livre${contributions.books > 1 ? 's' : ''} signalé${contributions.books > 1 ? 's' : ''}</span></div>`;
    $('#me-venue-cta').hidden = !culture;
    $('#admin').hidden = user.role !== 'admin';
    if (user.role === 'admin') renderReports();
  } catch (err) { toast(errMsg(err)); }
}

$('#btn-add-venue').addEventListener('click', () => {
  showView('view-map');
  state.pickDefaults = { category: 'venue', name: state.me.displayName };
  setPicking(true);
});

$('#btn-logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  state.me = null;
  setAuthTab('login');
  updateHeader();
  renderAccount();
  toast('Vous êtes déconnecté.');
});

$('#btn-delete-me').addEventListener('click', async () => {
  const pwd = prompt('Suppression définitive du compte. Les boîtes et livres que vous avez ajoutés resteront sur la carte, sans votre nom.\n\nConfirmez avec votre mot de passe :');
  if (!pwd) return;
  try {
    await api.deleteMe(pwd);
    state.me = null;
    updateHeader(); renderAccount();
    toast('Compte supprimé.');
  } catch (err) { toast(errMsg(err)); }
});

async function renderReports() {
  try {
    const { reports } = await api.reports();
    $('#reports').innerHTML = reports.length ? reports.map((r) => `<li><span class="fd-icon venue">${pi('flag')}</span><div>
      <time>${new Date(r.createdAt).toLocaleString('fr-FR')}</time>
      <p>« ${esc(r.reason)} » — ${esc(r.reporter ?? '?')}</p>
      <div class="row">${r.targetType === 'box' ? `<button class="pill" data-open-box="${r.targetId}" type="button">Voir la boîte</button>` : `<span class="small">Livre n° ${r.targetId}</span>`}
      <button class="pill solid" data-resolve="${r.id}" type="button">${pi('check')}Traité</button></div></div></li>`).join('')
      : `<li><span class="fd-icon">${pi('check')}</span><p>Aucun signalement en attente.</p></li>`;
  } catch (err) { toast(errMsg(err)); }
}
$('#reports').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.openBox) openBox(Number(t.dataset.openBox));
  if (t.dataset.resolve) { await api.resolveReport(t.dataset.resolve).catch((err) => toast(errMsg(err))); renderReports(); }
});

// ---------- Téléchargements ----------
function downloadJson(data, name, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#btn-backup').addEventListener('click', async () => {
  try { downloadJson(await api.backup(), `bibliorue-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`); }
  catch (err) { toast(errMsg(err)); }
});
$('#btn-export').addEventListener('click', async () => {
  try { downloadJson(await api.exportGeojson(), `bibliorue-${new Date().toISOString().slice(0, 10)}.geojson`, 'application/geo+json'); }
  catch (err) { toast(errMsg(err)); }
});

// ---------- Démarrage ----------
if (!isConfigured()) $('#setup-warning').hidden = false;
if (!storage.get('bibliorue:onboarded') && !/access_token|type=/.test(location.hash)) obOpen();
document.body.dataset.screen = 'view-map';
updateHeader();
(async () => {
  try {
    const { user } = await api.me();
    state.me = user;
  } catch { /* hors ligne : consultation seule */ }
  updateHeader();
  const startView = `view-${location.hash.slice(1)}`;
  if (document.getElementById(startView)) showView(startView);
  // Recentrage sur la position si l'utilisateur l'a déjà autorisée, sans redemander.
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') { const p = await locate(); map.setView([p.lat, p.lon], 14); return; }
  } catch { /* ignore */ }
  loadBoxes();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
