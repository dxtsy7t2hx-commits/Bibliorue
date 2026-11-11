// Interface de Bibliorue : carte communautaire, comptes, fiches, balades.
import { api, ApiError } from './api.js';
import { fetchOsmBookcases } from './overpass.js';
import { lookupIsbn } from './openlibrary.js';
import { distanceMeters, formatDistance, isValidCoord } from './geo.js';
import { planWalk, fetchWalkingRoute, navigationUrl } from './route.js';

const DEFAULT_VIEW = { lat: 46.6, lon: 2.4, zoom: 6 }; // France métropolitaine
// Palette « tampon » (identique à css/style.css)
const COLORS = { street: '#1f4fa8', venue: '#a4432b', osm: '#1f4fa8', me: '#1f4fa8', paper: '#f5efe3', ink: '#1d2345' };
const pi = (name, cls = '') => `<svg class="pi ${cls}" aria-hidden="true"><use href="#pi-${name}"/></svg>`;
const tile = (name, cls = '') => `<span class="tile ${cls}">${pi(name)}</span>`;
const VENUE_LABEL = {
  bibliotheque: 'Bibliothèque', mediatheque: 'Médiathèque', librairie: 'Librairie', cafe: 'Café-livres',
  association: 'Association', centre_culturel: 'Centre culturel', ecole: 'École / université', autre: 'Lieu culturel',
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMin = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);

const state = {
  me: null,
  boxes: new Map(),   // boîtes Bibliorue chargées (id → boîte)
  osm: new Map(),     // boîtes OSM pas encore importées
  showOsm: false,
  userPos: null,
  currentBox: null,
  picking: false,
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
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
const errMsg = (err) => (err instanceof ApiError ? err.message : `Problème de connexion (${err.message}).`);

// ---------- Navigation ----------
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'view-map') setTimeout(() => map.invalidateSize(), 0);
  if (id === 'view-community') renderCommunity();
  if (id === 'view-account') renderAccount();
  history.replaceState(null, '', `#${id.replace('view-', '')}`);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#btn-account').addEventListener('click', () => showView('view-account'));

// ---------- Carte ----------
const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
}).addTo(map);
const boxLayer = L.layerGroup().addTo(map);
const osmLayer = L.layerGroup().addTo(map);
const walkLayer = L.layerGroup().addTo(map);
let meMarker = null;

// Marqueurs : petits « tampons » carrés, pictogramme en réserve.
function stampIcon({ fill, glyph, glyphColor, outline = false, size = 36 }) {
  const r = Math.round(size * 0.28);
  const g = Math.round(size * 0.62);
  const off = (size - g) / 2;
  return L.divIcon({
    className: 'marker',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${r}" fill="${fill}" ${outline ? `stroke="${COLORS.osm}" stroke-width="2.5" stroke-dasharray="5 3"` : ''}/>
      <use href="#pi-${glyph}" x="${off}" y="${off - 1}" width="${g}" height="${g}" style="color:${glyphColor}"/></svg>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}
const ICONS = {
  street: stampIcon({ fill: COLORS.street, glyph: 'box', glyphColor: COLORS.paper }),
  venue: stampIcon({ fill: COLORS.venue, glyph: 'venue', glyphColor: COLORS.paper, size: 40 }),
  osm: stampIcon({ fill: COLORS.paper, glyph: 'box', glyphColor: COLORS.osm, outline: true, size: 32 }),
  me: L.divIcon({
    className: 'marker',
    html: `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="${COLORS.me}" stroke="${COLORS.paper}" stroke-width="3"/><use href="#pi-sparkle" x="8" y="8" width="18" height="18" style="color:${COLORS.paper}"/></svg>`,
    iconSize: [34, 34], iconAnchor: [17, 17],
  }),
};

function popupFor(box) {
  const div = document.createElement('div');
  const sub = box.category === 'venue'
    ? `${esc(VENUE_LABEL[box.createdBy?.venueKind] ?? 'Lieu culturel')}`
    : `${box.bookCount} livre(s) signalé(s)`;
  div.innerHTML = `<strong>${esc(box.name)}</strong><br><span class="meta">${sub}</span><br>`;
  const btn = document.createElement('button');
  btn.className = 'small primary';
  btn.textContent = 'Ouvrir la fiche';
  btn.onclick = () => openBox(box.id);
  div.append(btn);
  return div;
}

function renderMarkers() {
  boxLayer.clearLayers();
  for (const box of state.boxes.values()) {
    L.marker([box.lat, box.lon], { icon: ICONS[box.category], title: box.name, zIndexOffset: box.category === 'venue' ? 500 : 0 })
      .bindPopup(() => popupFor(box)).addTo(boxLayer);
  }
  osmLayer.clearLayers();
  if (!state.showOsm) return;
  const known = new Set([...state.boxes.values()].map((b) => b.osmId).filter(Boolean));
  for (const o of state.osm.values()) {
    if (known.has(o.osmId)) continue;
    L.marker([o.lat, o.lon], { icon: ICONS.osm, title: o.name, opacity: 0.85 }).bindPopup(() => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${esc(o.name)}</strong><br><span class="meta">Recensée dans OpenStreetMap,<br>pas encore sur Bibliorue.</span><br>`;
      const btn = document.createElement('button');
      btn.className = 'small primary';
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

function renderBoxList() {
  const ref = referencePoint();
  const list = [...state.boxes.values()]
    .map((b) => ({ ...b, distance: distanceMeters(ref, b) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 20);
  const ul = $('#box-list');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${pi('moon')}Aucune boîte par ici pour l'instant. Ajoutez celles que vous connaissez, ou affichez les « Boîtes OSM ».</li>`;
    return;
  }
  ul.innerHTML = list.map((b) => `
    <li><button class="card" data-box="${b.id}" type="button">
      ${b.category === 'venue' ? tile('venue', 'brick') : tile('box')}
      <span class="grow"><strong>${esc(b.name)}</strong>
        <span class="meta">${b.category === 'venue' ? esc(VENUE_LABEL[b.createdBy?.venueKind] ?? 'Lieu culturel') : `${b.bookCount} livre(s)`}${b.address ? ' · ' + esc(b.address) : ''}</span></span>
      <span class="dist">${formatDistance(b.distance)}</span>
    </button></li>`).join('');
}
for (const sel of ['#box-list', '#search-results']) {
  $(sel).addEventListener('click', (e) => {
    const id = e.target.closest('[data-box]')?.dataset.box;
    if (id) openBox(Number(id));
  });
}

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
  loadTimer = setTimeout(() => { loadBoxes(); if (state.showOsm) loadOsm(); }, 300);
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
    map.setView([pos.lat, pos.lon], 15);
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
  e.currentTarget.classList.toggle('primary', state.showOsm);
  if (state.showOsm) loadOsm(); else renderMarkers();
});

// Ajout d'une boîte : choisir l'emplacement sur la carte.
function setPicking(on) {
  state.picking = on;
  $('#map').classList.toggle('picking', on);
  $('#map-hint').hidden = !on;
}
$('#btn-add-box').addEventListener('click', () => {
  if (!requireLogin('ajouter une boîte')) return;
  setPicking(!state.picking);
});
$('#btn-cancel-pick').addEventListener('click', () => { setPicking(false); state.pickDefaults = null; });
map.on('click', (e) => {
  if (!state.picking) return;
  setPicking(false);
  openBoxForm({ lat: e.latlng.lat, lon: e.latlng.lng, ...state.pickDefaults });
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
  $('#boxform-title').textContent = box.id ? 'Modifier' : box.category === 'venue' ? 'Mon lieu culturel' : 'Nouvelle bibliothèque de rue';
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
      link.type = 'button'; link.className = 'small'; link.textContent = 'Voir la boîte existante';
      link.onclick = () => { $('#boxform-dialog').close(); openBox(err.data.existingId); };
      $('#boxform-msg').append(' ', link);
    }
  } finally { btn.disabled = false; }
});

// ---------- Fiche boîte ----------
function bookHtml(b) {
  const cover = b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="" loading="lazy">` : `<span class="nocover">${pi('book')}</span>`;
  const info = [b.authors, b.year, b.publisher].filter(Boolean).map(esc).join(' · ');
  const when = b.status === 'taken' ? `emprunté le ${fmtDate(b.changedAt)}` : `signalé le ${fmtDate(b.changedAt)}${b.addedBy ? ` par ${esc(b.addedBy.displayName)}` : ''}`;
  const actions = b.status === 'available'
    ? `<button class="small" data-act="take" data-id="${b.id}" type="button">Je le prends</button>
       <button class="small" data-act="gone" data-id="${b.id}" type="button" title="Le livre n'est plus dans la boîte">N'y est plus</button>
       <button class="small ghost" data-act="report-book" data-id="${b.id}" type="button" title="Signaler un contenu inapproprié" aria-label="Signaler">${pi('flag')}</button>`
    : `<button class="small" data-act="return" data-id="${b.id}" type="button">Je le redépose ici</button>`;
  return `<div class="book ${b.status}">${cover}<div class="grow"><strong>${esc(b.title)}</strong>
    <div class="meta">${info}</div>${b.note ? `<div class="meta">« ${esc(b.note)} »</div>` : ''}
    <div class="small">${when}${b.isbn ? ` · ISBN ${esc(b.isbn)}` : ''}</div>
    <div class="actions">${actions}</div></div></div>`;
}

function renderBox({ box, books }) {
  $('#box-title').innerHTML = `${box.category === 'venue' ? tile('venue', 'brick') : tile('box')}<span>${esc(box.name)}</span>`;
  const available = books.filter((b) => b.status === 'available');
  const taken = books.filter((b) => b.status === 'taken');
  const dist = state.userPos ? distanceMeters(state.userPos, box) : null;
  const mine = state.me && (state.me.id === box.createdBy?.id || state.me.role === 'admin');
  const route = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${state.userPos ? `${state.userPos.lat},${state.userPos.lon}` : ''};${box.lat},${box.lon}`;
  const c = box.createdBy;
  const creator = !c ? 'Ajoutée par un ancien membre'
    : c.accountType === 'culture'
      ? `<span class="creator venue">Ajoutée par <strong>${esc(c.displayName)}</strong> (${esc(VENUE_LABEL[c.venueKind] ?? 'lieu culturel')})${c.website ? ` · <a href="${esc(c.website)}" target="_blank" rel="noopener nofollow">site web</a>` : ''}</span>`
      : `Ajoutée par <strong>${esc(c.displayName)}</strong>`;
  $('#box-body').innerHTML = `
    <div class="box-head"><span class="badge ${box.category}">${box.category === 'venue' ? 'Lieu culturel' : 'Bibliothèque de rue'}</span>
      ${dist != null ? `<span class="dist">à ${formatDistance(dist)}</span>` : ''}</div>
    <div class="facts">
      ${box.address ? `<div>${pi('locate')}${esc(box.address)}</div>` : ''}
      ${box.hours ? `<div>${pi('clock')}${esc(box.hours)}</div>` : ''}
    </div>
    ${box.description ? `<p>${esc(box.description)}</p>` : ''}
    <p class="creator">${creator} · ${fmtDate(box.createdAt)}</p>
    <div class="row">
      <a class="button primary" href="${route}" target="_blank" rel="noopener">${pi('nav')}Y aller</a>
      ${box.osmId ? `<a class="button small" href="https://www.openstreetmap.org/${esc(box.osmId)}" target="_blank" rel="noopener">OSM</a>` : ''}
      ${mine ? `<button class="small" data-act="edit" type="button">${pi('pencil')}Modifier</button><button class="small danger" data-act="delete" type="button">${pi('trash')}Supprimer</button>` : ''}
      <button class="small ghost" data-act="report-box" type="button">${pi('flag')}Signaler</button>
    </div>
    <h3>Livres signalés (${available.length})</h3>
    ${available.length ? available.map(bookHtml).join('') : `<p class="empty">${pi('moon')}Aucun livre signalé pour l'instant.</p>`}
    ${taken.length ? `<details class="panel"><summary>${pi('books')}Récemment empruntés (${taken.length})</summary>${taken.map(bookHtml).join('')}</details>` : ''}`;
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
    if (!$('#box-dialog').open) $('#box-dialog').showModal();
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
  if (e.currentTarget.open && !state.me) { e.currentTarget.open = false; requireLogin('signaler un livre'); }
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
function stepMarker(n, color) {
  return L.divIcon({ className: '', html: `<span class="marker-num" style="background:${color}">${n}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
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

    walkLayer.clearLayers();
    if (!plan.stops.length) {
      out.innerHTML = `<p class="empty">${pi('moon')}Aucune boîte accessible en ${fmtMin(budgetMin)} depuis ce point (${candidates.length} candidate(s) dans la zone). Essayez plus de temps, un autre départ… ou ajoutez les boîtes que vous connaissez !</p>`;
      return;
    }

    // Tracé piéton réel (OSRM), à défaut lignes droites.
    const pts = [start, ...plan.stops, ...(f.loop.checked ? [start] : [])];
    let real = null;
    try { real = await fetchWalkingRoute(pts); } catch { /* repli sur l'estimation */ }
    L.polyline(real?.latlngs ?? pts.map((p) => [p.lat, p.lon]), { color: COLORS.venue, weight: 4, opacity: 0.9, dashArray: real ? '1 9' : '6 8', lineCap: 'round' }).addTo(walkLayer);
    L.marker([start.lat, start.lon], { icon: ICONS.me, zIndexOffset: 1500 }).bindTooltip('Départ').addTo(walkLayer);
    plan.stops.forEach((s, i) => L.marker([s.lat, s.lon], { icon: stepMarker(i + 1, COLORS[s.category]), zIndexOffset: 1000 })
      .bindTooltip(`${i + 1}. ${esc(s.name)}`).on('click', () => openBox(s.id)).addTo(walkLayer));

    const walkMin = real?.walkMin ?? plan.walkMin;
    const distM = real?.distanceM ?? plan.distanceM;
    const totalMin = walkMin + plan.stops.length * 5;
    const venues = plan.stops.filter((s) => s.category === 'venue').length;
    out.innerHTML = `
      <div class="walk-summary">
        <div class="stat${venues ? ' venue' : ''}"><b>${plan.stops.length}</b>étape(s)${venues ? ` dont ${venues} lieu(x) culturel(s)` : ''}</div>
        <div class="stat"><b>${formatDistance(distM)}</b>à pied</div>
        <div class="stat"><b>${fmtMin(totalMin)}</b>avec 5 min par arrêt</div>
      </div>
      ${real ? '' : '<p class="small">Tracé réel indisponible : distances estimées à vol d\'oiseau × 1,3.</p>'}
      ${totalMin > budgetMin * 1.15 ? '<p class="small">Attention : le trajet réel dépasse un peu le temps prévu (détours du réseau piéton).</p>' : ''}
      <ol class="walk-steps">
        <li><span class="step start">${pi('sparkle')}</span><strong class="display">Départ</strong></li>
        ${plan.stops.map((s, i) => `<li><span class="step ${s.category}">${i + 1}</span><button class="card" type="button" data-box="${s.id}">
          <span class="grow"><strong>${esc(s.name)}</strong><span class="meta">${s.category === 'venue' ? esc(VENUE_LABEL[s.createdBy?.venueKind] ?? 'Lieu culturel') : `${s.bookCount} livre(s)`}${s.hours ? ' · ' + esc(s.hours) : ''}</span></span></button></li>`).join('')}
        ${f.loop.checked ? `<li><span class="step start">${pi('sparkle')}</span><strong class="display">Retour au départ</strong></li>` : ''}
      </ol>
      <div class="row" style="margin-top:12px">
        <button type="button" class="primary" id="btn-walk-map">${pi('box')}Voir sur la carte</button>
        <a class="button" target="_blank" rel="noopener" href="${esc(navigationUrl(start, plan.stops, f.loop.checked))}">${pi('nav')}Ouvrir dans une appli GPS</a>
      </div>
      <p class="small">Itinéraire calculé avec OSRM sur les données OpenStreetMap. Vérifiez les horaires des lieux culturels.</p>`;
    $('#btn-walk-map').onclick = () => {
      showView('view-map');
      setTimeout(() => map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.15)), 50);
    };
    renderMarkers();
  } catch (err) {
    out.innerHTML = `<p class="msg error">${esc(errMsg(err))}</p>`;
  } finally { btn.disabled = false; }
});
$('#walk-result').addEventListener('click', (e) => {
  const id = e.target.closest('[data-box]')?.dataset.box;
  if (id) openBox(Number(id));
});

// ---------- Recherche ----------
let searchTimer;
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $('#search-input').value.trim();
    const ul = $('#search-results');
    if (q.length < 2) { ul.innerHTML = `<li class="empty">${pi('search')}Tapez au moins 2 caractères.</li>`; return; }
    try {
      const { results } = await api.search(q);
      const ref = referencePoint();
      results.sort((a, b) => distanceMeters(ref, a.box) - distanceMeters(ref, b.box));
      ul.innerHTML = results.length ? results.map((b) => `<li><button class="card" data-box="${b.box.id}" type="button">
        ${b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="" loading="lazy" style="width:42px;height:60px;object-fit:cover;border-radius:6px">` : tile('book', b.box.category === 'venue' ? 'brick' : '')}
        <span class="grow"><strong>${esc(b.title)}</strong>
        <span class="meta">${esc(b.authors)} — dans « ${esc(b.box.name)} »</span></span>
        <span class="dist">${formatDistance(distanceMeters(ref, b.box))}</span></button></li>`).join('')
        : `<li class="empty">${pi('moon')}Ce livre n'est signalé dans aucune boîte pour le moment.</li>`;
    } catch (err) { ul.innerHTML = `<li class="msg error">${esc(errMsg(err))}</li>`; }
  }, 250);
});

// ---------- Communauté ----------
const EVENT_LABEL = { book_deposited: 'a déposé', book_taken: 'a pris', book_gone: 'a signalé l\'absence de', box_added: 'a ajouté', box_removed: 'a retiré' };
async function renderCommunity() {
  try {
    const { stats, events } = await api.activity();
    $('#stats').innerHTML = `
      <div class="stat"><b>${stats.street}</b>bibliothèques de rue</div>
      <div class="stat venue"><b>${stats.venues}</b>lieux culturels</div>
      <div class="stat"><b>${stats.books}</b>livres signalés</div>
      <div class="stat"><b>${stats.members}</b>membres</div>`;
    $('#events').innerHTML = events.length ? events.map((e) => {
      const who = e.user ? `<strong${e.user.accountType === 'culture' ? ' style="color:var(--brick)"' : ''}>${esc(e.user.displayName)}</strong>` : 'Quelqu\'un';
      const what = e.type.startsWith('box') ? `la boîte « ${esc(e.title)} »` : `« ${esc(e.title)} »${e.boxName ? ` — ${esc(e.boxName)}` : ''}`;
      return `<li><time datetime="${esc(e.at)}">${new Date(e.at).toLocaleString('fr-FR')}</time>${who} ${EVENT_LABEL[e.type] ?? esc(e.type)} ${what}</li>`;
    }).join('') : `<li class="empty">${pi('sparkle')}Pas encore de contributions. Lancez-vous !</li>`;
  } catch (err) { $('#events').innerHTML = `<li class="msg error">${esc(errMsg(err))}</li>`; }
}

// ---------- Compte ----------
function setAuthTab(which) {
  document.querySelectorAll('[data-auth]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === which)));
  $('#login-form').hidden = which !== 'login';
  $('#register-form').hidden = which !== 'register';
}
document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.auth)));

const regForm = $('#register-form');
regForm.addEventListener('change', () => {
  const culture = regForm.accountType.value === 'culture';
  $('#venue-fields').hidden = !culture;
  $('#name-label').textContent = culture ? 'Nom du lieu' : 'Nom affiché (pseudonyme possible)';
});

function updateHeader() {
  const b = $('#btn-account');
  const culture = state.me?.accountType === 'culture';
  b.innerHTML = `${tile(culture ? 'venue' : 'user')}<span class="label">${state.me ? esc(state.me.displayName) : 'Connexion'}</span>`;
  b.classList.toggle('venue', state.me?.accountType === 'culture');
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
  try {
    const { user } = await api.register(Object.fromEntries(new FormData(regForm)));
    regForm.reset();
    await afterLogin(user, `Bienvenue sur Bibliorue, ${user.displayName} !`);
  } catch (err) { setMsg(regForm.querySelector('.msg'), errMsg(err), true); }
});

async function renderAccount() {
  $('#account-out').hidden = Boolean(state.me);
  $('#account-in').hidden = !state.me;
  if (!state.me) return;
  try {
    const { user, contributions } = await api.me();
    if (!user) { state.me = null; updateHeader(); return renderAccount(); }
    state.me = user;
    $('#me-name').textContent = user.displayName;
    $('#me-type').innerHTML = user.accountType === 'culture'
      ? `<span class="badge venue">${pi('venue')}${esc(VENUE_LABEL[user.venueKind] ?? 'Lieu culturel')}</span> ${user.website ? `<a href="${esc(user.website)}" target="_blank" rel="noopener">${esc(user.website)}</a>` : ''}`
      : `<span class="badge street">${pi('user')}Particulier</span>`;
    $('#me-type').innerHTML += ` <span class="small">· ${esc(user.email)} · membre depuis le ${fmtDate(user.createdAt)}</span>`;
    $('#me-stats').innerHTML = `<div class="stat"><b>${contributions.boxes}</b>boîte(s) ajoutée(s)</div><div class="stat"><b>${contributions.books}</b>livre(s) signalé(s)</div>`;
    $('#me-venue-cta').hidden = user.accountType !== 'culture';
    $('#admin').hidden = user.role !== 'admin';
    if (user.role === 'admin') renderReports();
  } catch (err) { toast(errMsg(err)); }
}

$('#btn-add-venue').addEventListener('click', () => {
  showView('view-map');
  toast('Touchez la carte à l\'emplacement de votre lieu.');
  state.pickDefaults = { category: 'venue', name: state.me.displayName };
  setPicking(true);
});

$('#btn-logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  state.me = null;
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
    $('#reports').innerHTML = reports.length ? reports.map((r) => `<li><time>${new Date(r.createdAt).toLocaleString('fr-FR')}</time>
      ${r.targetType === 'box' ? `<button class="small" data-open-box="${r.targetId}" type="button">Boîte n° ${r.targetId}</button>` : `Livre n° ${r.targetId}`}
      — « ${esc(r.reason)} » (${esc(r.reporter ?? '?')})
      <button class="small" data-resolve="${r.id}" type="button">Traité</button></li>`).join('')
      : '<li class="empty">Aucun signalement en attente.</li>';
  } catch (err) { toast(errMsg(err)); }
}
$('#reports').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.openBox) openBox(Number(t.dataset.openBox));
  if (t.dataset.resolve) { await api.resolveReport(t.dataset.resolve).catch((err) => toast(errMsg(err))); renderReports(); }
});

// ---------- Bandeau d'accueil (masquable, mémorisé sur l'appareil) ----------
try { if (localStorage.getItem('bibliorue:intro') === 'hidden') $('#intro').hidden = true; } catch { /* stockage indisponible */ }
$('#btn-intro-close').addEventListener('click', () => {
  $('#intro').hidden = true;
  try { localStorage.setItem('bibliorue:intro', 'hidden'); } catch { /* ignore */ }
});

// ---------- Démarrage ----------
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
