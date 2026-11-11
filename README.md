# Bibliorue

**Bibliorue** est une application web installable sur téléphone (une *PWA*, voir plus bas) pour **trouver les boîtes à livres** près de chez soi et **savoir quels livres s'y trouvent**.

> **Boîte à livres** (on dit aussi *bibliothèque de rue*, *armoire à livres* ou, en anglais, *Little Free Library*) : meuble installé dans l'espace public. Chacun peut y déposer ou y prendre des livres gratuitement, sans inscription ni obligation de rendre. Le mouvement *Little Free Library* est né en 2009 : à Hudson, dans le Wisconsin (États-Unis), Todd Bol fabrique alors une maquette d'école à classe unique remplie de livres (Little Free Library, s.d.). En France, ces boîtes sont souvent installées par des communes, des associations ou des habitants.

---

## 1. Ce que fait l'application

| Fonction | Détail |
|---|---|
| 🗺️ **Carte** | Fond OpenStreetMap avec les boîtes. Un repère vert signale une boîte issue d'OpenStreetMap, un repère brun une boîte que vous avez ajoutée. |
| 🔄 **Boîtes réelles** | Le bouton « Boîtes OpenStreetMap de la zone » interroge OpenStreetMap et récupère toutes les boîtes déjà recensées dans la partie visible de la carte. Dans OSM, ces boîtes portent l'étiquette `amenity=public_bookcase`. |
| 📍 **Près de moi** | Géolocalisation, puis liste des boîtes triées par distance. La distance est calculée à vol d'oiseau par la formule de haversine. |
| ＋ **Ajouter une boîte** | Touchez le bouton, puis l'emplacement sur la carte, et remplissez le nom, l'adresse et la description. |
| 📚 **Livres** | Pour chaque boîte : liste des livres signalés, dépôt d'un livre, « Je le prends » (emprunt), « Je le redépose ici », « Absent ». |
| 🔢 **ISBN** | Saisir l'ISBN (le numéro sous le code-barres) remplit automatiquement le titre, l'auteur, l'éditeur et la couverture via Open Library. Sur Chrome Android, le bouton 📷 lit directement le code-barres avec la caméra. |
| 🔎 **Recherche** | Par titre, auteur ou ISBN, dans toutes les boîtes. La recherche ignore les accents et les majuscules. |
| 📜 **Activité** | Statistiques et historique des dépôts et emprunts. |
| 💾 **Sauvegarde** | Export et import d'un fichier JSON, par exemple pour changer de téléphone ou partager un inventaire. |
| ✈️ **Hors ligne** | L'interface et vos données restent accessibles sans réseau. Les fonds de carte et les recherches en ligne ont besoin d'Internet. |

### Confidentialité
Tout est enregistré **uniquement sur l'appareil**, dans le `localStorage` du navigateur (un petit espace de stockage propre à chaque site). Il n'y a ni compte, ni serveur Bibliorue, ni traqueur. Les seules requêtes vers l'extérieur sont :
- les tuiles de carte, chez OpenStreetMap ;
- la recherche de boîtes, chez Overpass (lecture d'OpenStreetMap) ;
- la recherche ISBN, chez Open Library.

Ces requêtes contiennent la zone affichée ou l'ISBN saisi, jamais vos données personnelles.

---

## 2. Lancer l'application

Aucune compilation n'est nécessaire : ce sont des fichiers HTML, CSS et JavaScript « nus ».

### Sur votre ordinateur
```bash
git clone https://github.com/dxtsy7t2hx-commits/bibliorue.git
cd bibliorue
npm start            # ou : python3 -m http.server 8080
```
Ouvrez ensuite <http://localhost:8080>.

Un serveur web local est nécessaire : ouvrir `index.html` par double-clic ne suffit pas, car les navigateurs bloquent alors les modules JavaScript et le service worker.

### En ligne (gratuit) avec GitHub Pages
1. Sur GitHub, ouvrez **Settings → Pages**.
2. Dans **Source**, choisissez **GitHub Actions**.
3. Fusionnez ce travail dans la branche `main`.

Le workflow `.github/workflows/pages.yml` lance alors les tests puis publie le site à l'adresse `https://dxtsy7t2hx-commits.github.io/bibliorue/`.

### L'installer sur un téléphone
Ouvrez l'adresse dans le navigateur du téléphone :
- **Android (Chrome)** : menu ⋮ → *Installer l'application* ;
- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

L'application s'ouvre ensuite en plein écran, comme une application native. C'est le principe d'une **PWA** (*Progressive Web App*, « application web progressive ») : un site web qui, grâce à un fichier *manifest* et un *service worker*, peut s'installer et fonctionner hors ligne.

---

## 3. Organisation du code

```
index.html              structure de la page (4 onglets + 2 fenêtres de dialogue)
css/style.css           mise en forme (mobile d'abord, thème sombre automatique)
js/app.js               interface : carte Leaflet, affichage, événements
js/store.js             modèle de données, persistance, recherche, import/export
js/geo.js               calcul de distance (haversine)
js/isbn.js              validation des ISBN-10/13 (clé de contrôle) et conversion 10 → 13
js/overpass.js          requête vers OpenStreetMap via l'API Overpass (avec serveurs de secours)
js/openlibrary.js       fiche bibliographique à partir d'un ISBN
sw.js                   service worker (cache hors ligne)
manifest.webmanifest    métadonnées d'installation (nom, icônes, couleurs)
icons/                  icônes de l'application
tests/                  tests unitaires (node:test, sans dépendance)
.github/workflows/      tests automatiques + déploiement GitHub Pages
```

**Choix techniques.** Il n'y a ni framework ni dépendance à installer : seule la bibliothèque cartographique **Leaflet 1.9.4** est chargée depuis un CDN. Son intégrité est vérifiée par une empreinte SRI (*Subresource Integrity* : le navigateur refuse le fichier s'il a été modifié). La logique métier (`store`, `geo`, `isbn`, `overpass`, `openlibrary`) n'utilise pas le DOM, ce qui permet de la tester avec Node.js.

### Tests
```bash
npm test
```
Les 14 tests couvrent :
- la validation des ISBN ;
- les distances ;
- l'analyse des réponses d'OpenStreetMap et d'Open Library ;
- le basculement vers un serveur de secours ;
- le cycle dépôt → emprunt → redépôt ;
- la recherche sans accents ;
- la persistance ;
- l'import/export et la résistance aux fichiers corrompus.

### Format des données (export JSON, `version: 1`)
```json
{
  "version": 1,
  "boxes":  { "<id>": { "name": "…", "lat": 45.76, "lon": 4.83, "source": "local|osm", "osmId": "node/123", "address": "…", "description": "…" } },
  "books":  { "<id>": { "boxId": "<id>", "title": "…", "authors": "…", "isbn": "978…", "status": "available|taken", "addedAt": "ISO-8601", "takenAt": null } },
  "events": [ { "type": "book_deposited|book_taken|box_added|box_removed", "at": "ISO-8601", "boxId": "…", "bookId": "…", "title": "…" } ]
}
```

---

## 4. Limites connues et pistes d'évolution

- **Données locales, non partagées.** Les livres que vous signalez ne sont visibles que sur votre appareil, ou chez ceux à qui vous envoyez l'export. Un inventaire partagé en temps réel entre tous les utilisateurs demanderait un serveur avec une base de données et une modération (risques de spam et de fausses informations). C'est l'évolution naturelle de l'application.
- **Inventaire déclaratif.** Le contenu réel d'une boîte change sans cesse. La liste reflète ce que les utilisateurs ont signalé, avec sa date, et non une vérité garantie.
- **Contribuer à OpenStreetMap.** Une boîte ajoutée dans Bibliorue n'est pas envoyée à OSM. Pour la rendre visible de tous, ajoutez-la sur <https://www.openstreetmap.org> avec l'étiquette `amenity=public_bookcase`.
- **Services publics gratuits.** Overpass, Open Library et les tuiles OSM sont gérés par des bénévoles ou des associations. Ils peuvent être lents ou saturés : c'est pourquoi deux serveurs Overpass de secours sont prévus. Pour un usage intensif, la politique d'usage des tuiles OSM demande de passer à un fournisseur dédié (OpenStreetMap Foundation, s.d.).
- **Lecteur de code-barres.** L'API `BarcodeDetector` n'existe pas encore dans tous les navigateurs, notamment Safari et Firefox (MDN, s.d.). La saisie manuelle de l'ISBN reste toujours possible.

---

## 5. Sources (APA 7)

Agafonkin, V. (s.d.). *Leaflet: An open-source JavaScript library for mobile-friendly interactive maps* (version 1.9.4) [Logiciel]. https://leafletjs.com/

Internet Archive. (s.d.). *Open Library Books API*. Consulté le 11 novembre 2026, à l'adresse https://openlibrary.org/dev/docs/api/books

International ISBN Agency. (2017). *ISBN users' manual* (7ᵉ éd.). https://www.isbn-international.org/content/isbn-users-manual/29

Little Free Library. (s.d.). *History*. Consulté le 11 novembre 2026, à l'adresse https://littlefreelibrary.org/history/

MDN contributors. (s.d.). *BarcodeDetector*. MDN Web Docs. Consulté le 11 novembre 2026, à l'adresse https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector

Moritz, H. (2000). Geodetic Reference System 1980. *Journal of Geodesy, 74*(1), 128–133. https://doi.org/10.1007/s001900050278

Olbricht, R. (s.d.). *Overpass API user's manual*. Consulté le 11 novembre 2026, à l'adresse https://dev.overpass-api.de/overpass-doc/en/

Open Data Commons. (s.d.). *Open Database License (ODbL) v1.0*. https://opendatacommons.org/licenses/odbl/

OpenStreetMap Foundation. (s.d.). *Tile usage policy*. Consulté le 11 novembre 2026, à l'adresse https://operations.osmfoundation.org/policies/tiles/

OpenStreetMap Wiki contributors. (s.d.). *Tag:amenity=public_bookcase*. OpenStreetMap Wiki. Consulté le 11 novembre 2026, à l'adresse https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase

---

Données cartographiques © contributeurs OpenStreetMap, sous licence ODbL. Code sous licence MIT (voir `LICENSE`).
