// Interface de Bibliorue : carte, fiches des boîtes, dépôts/emprunts, recherche, sauvegarde.
import { Store } from './store.js';
import { fetchOsmBookcases } from './overpass.js';
import { lookupIsbn } from './openlibrary.js';
import { formatDistance, isValidCoord } from './geo.js';

export const APP_VERSION = '1.0.0';
const DEFAULT_VIEW = { lat: 46.6, lon: 2.4, zoom: 6 }; // France métropolitaine

const store = new Store();
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let userPos = null;
let currentBoxId = null;
let pickingLocation = false;

// ---------- Notifications ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------- Navigation ----------
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'view-map') setTimeout(() => map.invalidateSize(), 0);
  if (id === 'view-activity') renderActivity();
  history.replaceState(null, '', `#${id.replace('view-', '')}`);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- Carte ----------
const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
}).addTo(map);
const markers = L.layerGroup().addTo(map);
let userMarker = null;

function boxIcon(box) {
  const color = box.source === 'osm' ? '#2f6f5e' : '#7a3e1d';
  return L.divIcon({
    className: '',
    html: `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 22 2 14a13 13 0 0 1 26 0c0 8-13 23-13 23z" fill="${color}" stroke="#fff" stroke-width="2"/><rect x="9" y="8" width="12" height="11" rx="1.5" fill="#fff"/><path d="M15 9v9" stroke="${color}" stroke-width="1.5"/></svg>`,
    iconSize: [30, 38], iconAnchor: [15, 37], popupAnchor: [0, -32],
  });
}

function renderMarkers() {
  markers.clearLayers();
  for (const box of store.listBoxes()) {
    const n = store.booksInBox(box.id).length;
    L.marker([box.lat, box.lon], { icon: boxIcon(box), title: box.name })
      .bindPopup(() => {
        const div = document.createElement('div');
        div.innerHTML = `<strong>${esc(box.name)}</strong><br><small>${n} livre(s) signalé(s)</small><br>`;
        const btn = document.createElement('button');
        btn.className = 'small primary';
        btn.textContent = 'Ouvrir la fiche';
        btn.onclick = () => openBox(box.id);
        div.append(btn);
        return div;
      })
      .addTo(markers);
  }
}

function renderBoxList() {
  const center = userPos ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };
  const list = store.nearestBoxes(center, 20);
  const ul = $('#box-list');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">Aucune boîte pour l'instant. Utilisez « Boîtes OpenStreetMap de la zone » ou ajoutez-en une.</li>`;
    return;
  }
  ul.innerHTML = list.map((b) => `
    <li><button class="card" data-box="${esc(b.id)}" type="button">
      <span class="grow"><strong>${esc(b.name)}</strong>
        <span class="meta">${esc(b.address || '')} ${b.address ? '·' : ''} ${store.booksInBox(b.id).length} livre(s)</span></span>
      <span class="badge ${b.source}">${b.source === 'osm' ? 'OSM' : 'perso'}</span>
      <span class="meta">${formatDistance(b.distance)}</span>
    </button></li>`).join('');
}
$('#box-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-box]')?.dataset.box;
  if (id) openBox(id);
});
map.on('moveend', renderBoxList);

$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Géolocalisation non disponible sur cet appareil.');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      userPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      map.setView([userPos.lat, userPos.lon], 15);
      if (userMarker) userMarker.remove();
      userMarker = L.circleMarker([userPos.lat, userPos.lon], { radius: 8, color: '#1a73e8', fillOpacity: 0.8 })
        .addTo(map).bindTooltip('Vous êtes ici');
      renderBoxList();
    },
    (err) => toast(`Position indisponible : ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

$('#btn-osm').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (map.getZoom() < 11) return toast('Zoomez davantage (quartier ou ville) avant de charger les boîtes.');
  const b = map.getBounds();
  btn.disabled = true;
  try {
    const boxes = await fetchOsmBookcases({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    const added = store.mergeOsmBoxes(boxes);
    toast(`${boxes.length} boîte(s) trouvée(s) dans OpenStreetMap, ${added} nouvelle(s).`);
  } catch (err) {
    toast(`Échec du chargement OpenStreetMap : ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// Ajout d'une boîte : choisir l'emplacement sur la carte.
$('#btn-add-box').addEventListener('click', () => {
  pickingLocation = !pickingLocation;
  $('#map').classList.toggle('picking', pickingLocation);
  $('#map-hint').hidden = !pickingLocation;
});
map.on('click', (e) => {
  if (!pickingLocation) return;
  pickingLocation = false;
  $('#map').classList.remove('picking');
  $('#map-hint').hidden = true;
  openBoxForm({ lat: e.latlng.lat, lon: e.latlng.lng });
});

// ---------- Formulaire boîte ----------
function openBoxForm(box) {
  const f = $('#boxform');
  f.reset();
  f.id.value = box.id ?? '';
  f.name.value = box.name ?? '';
  f.address.value = box.address ?? '';
  f.description.value = box.description ?? '';
  f.lat.value = box.lat?.toFixed(6) ?? '';
  f.lon.value = box.lon?.toFixed(6) ?? '';
  f.lat.readOnly = f.lon.readOnly = Boolean(box.id);
  $('#boxform-title').textContent = box.id ? 'Modifier la boîte' : 'Nouvelle boîte à livres';
  $('#boxform-msg').textContent = '';
  $('#boxform-dialog').showModal();
}
$('#boxform').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const data = Object.fromEntries(new FormData(f));
  const lat = Number(String(data.lat).replace(',', '.'));
  const lon = Number(String(data.lon).replace(',', '.'));
  try {
    if (!isValidCoord(lat, lon)) throw new Error('Coordonnées invalides.');
    if (data.id) {
      store.updateBox(data.id, data);
      toast('Boîte modifiée.');
      $('#boxform-dialog').close();
      openBox(data.id);
    } else {
      const box = store.addBox({ ...data, lat, lon });
      toast('Boîte ajoutée.');
      $('#boxform-dialog').close();
      openBox(box.id);
    }
  } catch (err) {
    $('#boxform-msg').textContent = err.message;
    $('#boxform-msg').classList.add('error');
  }
});

// ---------- Fiche boîte ----------
function bookHtml(b, { withActions = true } = {}) {
  const cover = b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="" loading="lazy">` : `<span class="nocover" aria-hidden="true">📕</span>`;
  const info = [b.authors, b.year, b.publisher].filter(Boolean).map(esc).join(' · ');
  const when = b.status === 'taken'
    ? `emprunté le ${new Date(b.takenAt).toLocaleDateString('fr-FR')}`
    : `déposé le ${new Date(b.addedAt).toLocaleDateString('fr-FR')}`;
  const actions = !withActions ? '' : b.status === 'available'
    ? `<button class="small" data-take="${esc(b.id)}" type="button">Je le prends</button>
       <button class="small" data-del="${esc(b.id)}" type="button" title="N'est plus dans la boîte">Absent</button>`
    : `<button class="small" data-return="${esc(b.id)}" type="button">Je le redépose ici</button>`;
  return `<div class="book ${b.status}">${cover}<div class="grow"><strong>${esc(b.title)}</strong>
    <div class="meta">${info}</div>
    ${b.note ? `<div class="meta">« ${esc(b.note)} »</div>` : ''}
    <div class="small">${when}${b.isbn ? ` · ISBN ${esc(b.isbn)}` : ''}</div>
    <div class="actions">${actions}</div></div></div>`;
}

function renderBox() {
  const box = store.getBox(currentBoxId);
  if (!box) return $('#box-dialog').close();
  $('#box-title').textContent = box.name;
  const available = store.booksInBox(box.id);
  const taken = store.booksInBox(box.id, { includeTaken: true }).filter((b) => b.status === 'taken');
  const dist = userPos ? store.nearestBoxes(userPos).find((b) => b.id === box.id)?.distance : null;
  const osmLink = box.osmId ? `<a href="https://www.openstreetmap.org/${esc(box.osmId)}" target="_blank" rel="noopener">Voir sur OpenStreetMap</a>` : '';
  const route = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${userPos ? `${userPos.lat},${userPos.lon}` : ''};${box.lat},${box.lon}`;
  $('#box-body').innerHTML = `
    <p class="meta">
      <span class="badge ${box.source}">${box.source === 'osm' ? 'OpenStreetMap' : 'Ajoutée par vous'}</span>
      ${box.address ? esc(box.address) : ''} ${dist != null ? `· à ${formatDistance(dist)}` : ''}
    </p>
    ${box.description ? `<p>${esc(box.description)}</p>` : ''}
    <div class="row">
      <a class="button" href="${route}" target="_blank" rel="noopener">🚶 Itinéraire</a>
      ${osmLink ? `<span class="small">${osmLink}</span>` : ''}
      <button class="small" id="btn-edit-box" type="button">Modifier</button>
      ${box.source === 'local' ? '<button class="small danger" id="btn-del-box" type="button">Supprimer</button>' : ''}
    </div>
    <h3>Livres signalés (${available.length})</h3>
    ${available.length ? available.map((b) => bookHtml(b)).join('') : '<p class="empty">Aucun livre signalé. Soyez le premier !</p>'}
    ${taken.length ? `<details class="panel"><summary>Déjà empruntés (${taken.length})</summary>${taken.map((b) => bookHtml(b)).join('')}</details>` : ''}`;
}

function openBox(id) {
  currentBoxId = id;
  map.closePopup();
  $('#book-form').reset();
  $('#book-msg').textContent = '';
  $('#add-book').open = false;
  renderBox();
  if (!$('#box-dialog').open) $('#box-dialog').showModal();
}

$('#box-dialog').addEventListener('close', stopScan);
$('#box-body').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  try {
    if (t.dataset.take) { store.takeBook(t.dataset.take); toast('Bonne lecture ! 📖'); }
    else if (t.dataset.return) { store.returnBook(t.dataset.return, currentBoxId); toast('Merci pour le dépôt !'); }
    else if (t.dataset.del) { if (confirm('Ce livre n\'est plus dans la boîte ? Il sera retiré de la liste.')) store.removeBook(t.dataset.del); }
    else if (t.id === 'btn-edit-box') { $('#box-dialog').close(); openBoxForm(store.getBox(currentBoxId)); }
    else if (t.id === 'btn-del-box') {
      if (confirm('Supprimer cette boîte et tous ses livres ?')) { store.removeBox(currentBoxId); $('#box-dialog').close(); toast('Boîte supprimée.'); }
    }
  } catch (err) { toast(err.message); }
});

// ---------- Dépôt d'un livre ----------
const bookForm = $('#book-form');
function bookMsg(text, isError = false) {
  $('#book-msg').textContent = text;
  $('#book-msg').classList.toggle('error', isError);
}

async function fillFromIsbn() {
  const isbn = bookForm.isbn.value;
  if (!isbn.trim()) return bookMsg('Saisissez d\'abord un ISBN.', true);
  bookMsg('Recherche dans Open Library…');
  try {
    const info = await lookupIsbn(isbn);
    if (!info) return bookMsg('ISBN valide mais inconnu d\'Open Library : complétez à la main.', true);
    for (const k of ['title', 'authors', 'year', 'publisher', 'coverUrl']) bookForm[k].value = info[k] ?? '';
    bookForm.isbn.value = info.isbn;
    bookMsg('Fiche complétée. Vérifiez puis enregistrez.');
  } catch (err) {
    bookMsg(err.message, true);
  }
}
$('#btn-isbn').addEventListener('click', fillFromIsbn);

bookForm.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    store.addBook(currentBoxId, Object.fromEntries(new FormData(bookForm)));
    bookForm.reset();
    bookMsg('');
    $('#add-book').open = false;
    toast('Livre ajouté à la boîte. Merci !');
  } catch (err) {
    bookMsg(err.message, true);
  }
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
    bookMsg('Visez le code-barres au dos du livre…');
    const loop = async () => {
      if (!scanStream) return;
      const codes = await detector.detect(video).catch(() => []);
      const isbn = codes.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v));
      if (isbn) { stopScan(); bookForm.isbn.value = isbn; fillFromIsbn(); } else requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    stopScan();
    bookMsg(`Caméra indisponible : ${err.message}`, true);
  }
}
function stopScan() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  $('#scan-video').hidden = true;
}
$('#btn-scan').addEventListener('click', () => (scanStream ? stopScan() : startScan()));

// ---------- Recherche ----------
function renderSearch() {
  const q = $('#search-input').value;
  const results = store.searchBooks(q, { includeTaken: $('#search-taken').checked });
  const ul = $('#search-results');
  if (!q.trim()) { ul.innerHTML = '<li class="empty">Tapez un titre, un auteur ou un ISBN.</li>'; return; }
  if (!results.length) { ul.innerHTML = '<li class="empty">Aucun livre trouvé dans les boîtes connues.</li>'; return; }
  ul.innerHTML = results.map((b) => {
    const box = store.getBox(b.boxId);
    return `<li><button class="card" data-box="${esc(b.boxId)}" type="button">
      <span class="grow"><strong>${esc(b.title)}</strong>
      <span class="meta">${esc(b.authors)} — ${b.status === 'taken' ? 'emprunté, vu dans' : 'dans'} « ${esc(box?.name)} »</span></span>
    </button></li>`;
  }).join('');
}
$('#search-input').addEventListener('input', renderSearch);
$('#search-taken').addEventListener('change', renderSearch);
$('#search-results').addEventListener('click', (e) => {
  const id = e.target.closest('[data-box]')?.dataset.box;
  if (id) openBox(id);
});

// ---------- Activité ----------
const EVENT_LABEL = {
  book_deposited: 'Dépôt de', book_taken: 'Emprunt de', box_added: 'Nouvelle boîte', box_removed: 'Boîte supprimée',
};
function renderActivity() {
  const s = store.stats();
  $('#stats').innerHTML = `
    <div class="stat"><b>${s.boxes}</b>boîtes connues</div>
    <div class="stat"><b>${s.available}</b>livres disponibles</div>
    <div class="stat"><b>${s.taken}</b>livres empruntés</div>`;
  const ev = store.state.events.slice(0, 100);
  $('#events').innerHTML = ev.length ? ev.map((e) => {
    const box = store.getBox(e.boxId);
    return `<li><time datetime="${esc(e.at)}">${new Date(e.at).toLocaleString('fr-FR')}</time>
      ${EVENT_LABEL[e.type] ?? esc(e.type)} ${e.title ? `« ${esc(e.title)} »` : ''} ${box ? `— ${esc(box.name)}` : ''}</li>`;
  }).join('') : '<li class="empty">Aucune activité pour le moment.</li>';
}

// ---------- Sauvegarde ----------
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bibliorue-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const r = store.importJson(await file.text(), { merge: true });
    toast(`Import réussi : ${r.boxes} boîte(s), ${r.books} livre(s).`);
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', () => {
  if (confirm('Effacer toutes les données de Bibliorue sur cet appareil ? Pensez à exporter avant.')) {
    store.reset();
    toast('Données effacées.');
  }
});
$('#app-version').textContent = APP_VERSION;

// ---------- Rafraîchissement ----------
function refresh() {
  renderMarkers();
  renderBoxList();
  if ($('#box-dialog').open) renderBox();
  if ($('#view-search').classList.contains('active')) renderSearch();
  if ($('#view-activity').classList.contains('active')) renderActivity();
}
store.subscribe(refresh);
refresh();
renderSearch();

// Centrage initial sur les boîtes déjà connues.
const known = store.listBoxes();
if (known.length) map.fitBounds(L.latLngBounds(known.map((b) => [b.lat, b.lon])).pad(0.2), { maxZoom: 15 });

const startView = `view-${location.hash.slice(1)}`;
if (document.getElementById(startView)) showView(startView);

// ---------- Mode hors ligne (PWA) ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
