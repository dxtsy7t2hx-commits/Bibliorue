# Bibliorue

**Bibliorue** est une **carte communautaire des bibliothèques de rue**. Tout le monde peut la consulter. Les membres inscrits y ajoutent les boîtes qu'ils connaissent et les livres qu'ils y voient. L'application **propose aussi des balades** qui vont de boîte en boîte, selon le temps dont on dispose.

Les **lieux culturels** (bibliothèques, médiathèques, librairies, cafés-livres, associations…) peuvent s'inscrire comme tels. Ils apparaissent alors **en violet** sur la carte, et les promeneurs peuvent les inclure dans leur balade.

---

## 1. Contexte

Une **bibliothèque de rue** (ou « boîte à livres ») est un meuble en libre accès dans l'espace public : chacun y dépose et y prend des livres gratuitement, sans inscription ni obligation de rendre.

Le mouvement anglophone *Little Free Library* fait remonter son origine à 2009. Cette année-là, à Hudson (Wisconsin, États-Unis), Todd Bol fabrique une maquette d'école remplie de livres (Little Free Library, s.d.). En France, les boîtes sont installées par des communes, des associations ou des habitants.

### Ce qui existe déjà
- **Des annuaires collaboratifs**, comme *Boîte à lire* ou *Le Bouquin Français*, où l'on ajoute une boîte par formulaire (Outils Tice, 2020).
- **Des cartes locales** : Ville de Paris (s.d.), ou la Région Île-de-France pour ses 100 boîtes en gare (Région Île-de-France, s.d.).
- **Un jeu de données** sur data.gouv.fr (s.d.).
- **OpenStreetMap**, la carte libre et collaborative mondiale, où les boîtes sont décrites avec l'étiquette `amenity=public_bookcase` (OpenStreetMap Wiki contributors, s.d.).

### Ce que Bibliorue ajoute
Les quatre éléments réunis dans une même application :
1. la carte communautaire ;
2. l'inventaire des livres de chaque boîte ;
3. un **conseiller de balade** ;
4. une **place spécifique pour les lieux culturels**.

Bibliorue se branche aussi sur OpenStreetMap : les boîtes déjà recensées y apparaissent en gris et s'importent en un clic.

---

## 2. Fonctions

| | |
|---|---|
| 🗺️ **Carte partagée** | Visible sans compte. Code couleur : 🟤 bibliothèque de rue · 🟣 lieu culturel · ⚪ boîte recensée dans OSM mais pas encore sur Bibliorue · 🔵 vous. |
| 👤 **Comptes** | Obligatoires pour ajouter une boîte ou un livre, indiquer qu'on prend un livre, ou signaler un contenu. Deux types d'inscription : **Particulier** ou **Lieu culturel** (avec le type de lieu et un site web). |
| 🏛️ **Lieux culturels** | Seul un compte « lieu culturel » peut placer un lieu violet. La règle est vérifiée par le serveur, pas seulement par l'interface. Sa fiche affiche le type de lieu, ses horaires et son site. |
| ➕ **Ajout de boîte** | On touche la carte à l'emplacement exact de la boîte. Le serveur **refuse les doublons** : une autre boîte à moins de 15 m, ou le même identifiant OSM. |
| 📚 **Livres** | Dépôt, avec fiche remplie automatiquement à partir de l'ISBN via Open Library, ou par scan du code-barres. Puis « Je le prends », « Je le redépose ici », « N'y est plus ». |
| 🚶 **Balade** | On choisit son temps disponible (30 min à 4 h), une boucle ou un aller simple, et si l'on inclut les lieux culturels. Bibliorue choisit les étapes, les ordonne et trace l'itinéraire piéton réel. La balade s'ouvre ensuite dans une application GPS. |
| 🔎 **Recherche** | Un livre précis, dans toutes les boîtes, trié par distance. |
| 🤝 **Communauté** | Statistiques et fil des dernières contributions. |
| ⚑ **Modération** | Tout membre peut signaler un contenu. Les modérateurs (variable `ADMIN_EMAILS`) voient les signalements et peuvent corriger ou supprimer n'importe quelle boîte. |
| 📤 **Données ouvertes** | Export public de la carte en GeoJSON (`/api/export.geojson`), sans aucune donnée personnelle. |
| ✈️ **Hors ligne** | L'interface et la dernière carte consultée restent disponibles sans réseau. |

### Comment la balade est calculée
Il s'agit de visiter le plus de boîtes intéressantes dans un temps limité. En recherche opérationnelle (la discipline mathématique de l'optimisation), c'est le **problème d'orientation** (*orienteering problem*, Golden et al., 1987).

Ce problème est **NP-difficile** : aucune méthode connue ne garantit la meilleure solution en un temps raisonnable dès qu'il y a beaucoup de points. On utilise donc une **heuristique**, c'est-à-dire une méthode rapide qui donne une très bonne solution sans prouver qu'elle est la meilleure :

1. **Insertion la moins coûteuse.** On ajoute à chaque fois la boîte qui apporte le plus d'intérêt pour le moins de minutes supplémentaires. L'intérêt est plus élevé si la boîte contient des livres ou s'il s'agit d'un lieu culturel.
2. **Amélioration « 2-opt »** (Croes, 1958). On inverse des portions du parcours tant que cela le raccourcit. Résultat : un tracé sans croisements.
3. **Nouvel essai d'insertion** avec le temps ainsi libéré.

Les temps sont d'abord estimés à vol d'oiseau, avec une marche à 4,5 km/h, un facteur de détour de 1,3 et 5 min par arrêt. L'itinéraire réel dans les rues est ensuite demandé au moteur **OSRM** (Luxen & Vetter, 2011), sur le serveur public de l'association FOSSGIS. Le code est dans `js/route.js`.

---

## 3. Lancer l'application

**Prérequis :** Node.js **22.13 ou plus récent**. C'est tout : aucune dépendance à installer, la base de données SQLite est intégrée à Node.

```bash
git clone https://github.com/dxtsy7t2hx-commits/bibliorue.git
cd bibliorue
ADMIN_EMAILS=vous@exemple.fr npm start
```
Ouvrez <http://localhost:8080>. Les données sont stockées dans `data/bibliorue.db`. Les variables de configuration sont décrites dans `.env.example`.

### Mise en ligne
L'application a besoin d'un **serveur Node.js avec un disque persistant**. Sans disque persistant, la base de données serait effacée à chaque redémarrage. GitHub Pages ne convient donc plus : il ne sert que des fichiers fixes, sans serveur.

Avec Docker, sur un hébergeur qui accepte les images Docker et les volumes (Fly.io, Railway, Render avec disque, un VPS…) :
```bash
docker build -t bibliorue .
docker run -p 8080:8080 -v bibliorue-data:/data -e ADMIN_EMAILS=vous@exemple.fr bibliorue
```
En production, servez l'application **en HTTPS**. Les hébergeurs cités le font automatiquement. C'est nécessaire pour trois choses : la géolocalisation, le scan par caméra et la sécurité des cookies de session.

**Sauvegarde :** il suffit de copier le fichier `bibliorue.db`. Faites-le régulièrement.

### Tests
```bash
npm test
```
Il y a 28 tests automatiques :
- l'API : comptes, droits, doublons, livres, modération, protection CSRF, suppression de compte, limitation des tentatives de connexion ;
- l'algorithme de balade ;
- les ISBN, les distances, l'analyse des réponses d'OpenStreetMap et d'Open Library.

---

## 4. Organisation du code

```
server/index.js     démarrage du serveur HTTP
server/app.js       API REST + service des fichiers de l'interface
server/auth.js      mots de passe (scrypt), sessions, limitation de débit
server/db.js        schéma SQLite (users, sessions, boxes, books, events, reports)
index.html, css/    interface (mobile d'abord, thème sombre automatique)
js/app.js           logique de l'interface (carte Leaflet, fiches, balade, compte)
js/api.js           client de l'API
js/route.js         conseiller de balade + itinéraire OSRM
js/geo.js, isbn.js, overpass.js, openlibrary.js   modules utilitaires (partagés client/serveur)
sw.js, manifest.webmanifest                       application installable et hors ligne
tests/              tests node:test
Dockerfile          image de production
```

### Sécurité et vie privée
- **Mots de passe** hachés avec **scrypt** (Percival, 2009). Le hachage transforme le mot de passe de façon irréversible ; le sel aléatoire empêche de comparer deux comptes entre eux.
- **Sessions** : jeton aléatoire de 256 bits, placé dans un cookie `HttpOnly` (illisible par un script de la page) et `SameSite=Lax`. Seule l'empreinte du jeton est stockée en base.
- **Protection CSRF** (attaque où un autre site déclenche une action à votre insu) : les écritures exigent du JSON et une origine identique à celle du site.
- **En-têtes de sécurité** : politique de sécurité du contenu (CSP) et interdiction d'afficher le site dans un cadre.
- **Échappement systématique** des textes affichés, pour empêcher l'injection de code (XSS).
- **Limitation des tentatives** : connexion et inscription limitées par adresse IP, écritures limitées par compte.
- **L'e-mail n'est jamais public.** Seul le nom choisi apparaît, et un pseudonyme est possible.
- **Droit à l'effacement** (RGPD, art. 17) : « Supprimer mon compte » efface le compte. Les boîtes et livres ajoutés restent sur la carte commune, sans nom.

---

## 5. À faire avant une ouverture au public

1. **Mentions légales et politique de confidentialité.** Le site conserve des e-mails : le RGPD s'applique. Il faut indiquer qui est responsable du traitement, à quoi servent les données et combien de temps on les garde (CNIL, s.d.).
2. **Vérification de l'e-mail et mot de passe oublié.** Ces fonctions ne sont pas encore faites, car elles exigent un service d'envoi d'e-mails. D'ici là, un mot de passe oublié ne peut pas être récupéré.
3. **Vérification des lieux culturels.** Aujourd'hui, l'inscription « lieu culturel » est déclarative : n'importe qui peut cocher la case. Un badge « vérifié », attribué par un modérateur, éviterait les usurpations.
4. **Photos des boîtes**, très utiles pour les reconnaître sur place. Elles demandent du stockage et une modération des images.
5. **Contribution en retour à OpenStreetMap.** Les boîtes ajoutées ici n'y sont pas envoyées automatiquement.
6. **Montée en charge.** Les serveurs publics Overpass, OSRM et les tuiles OSM sont gérés par des bénévoles et ont des règles d'usage (OpenStreetMap Foundation, s.d.). Avec beaucoup d'utilisateurs, il faudra un fournisseur de tuiles et d'itinéraires dédié.

---

## 6. Sources (APA 7)

CNIL. (s.d.). *RGPD : par où commencer*. Consulté le 11 novembre 2026, à l'adresse https://www.cnil.fr/fr/rgpd-par-ou-commencer

Croes, G. A. (1958). A method for solving traveling-salesman problems. *Operations Research, 6*(6), 791–812. https://doi.org/10.1287/opre.6.6.791

data.gouv.fr. (s.d.). *Boîtes à livres* [Jeu de données]. Consulté le 11 novembre 2026, à l'adresse https://data.gouv.fr/en/datasets/boites-a-livres

Golden, B. L., Levy, L., & Vohra, R. (1987). The orienteering problem. *Naval Research Logistics, 34*(3), 307–318. https://doi.org/10.1002/1520-6750(198706)34:3<307::AID-NAV3220340302>3.0.CO;2-D

Internet Archive. (s.d.). *Open Library Books API*. Consulté le 11 novembre 2026, à l'adresse https://openlibrary.org/dev/docs/api/books

Little Free Library. (s.d.). *History*. Consulté le 11 novembre 2026, à l'adresse https://littlefreelibrary.org/history/

Luxen, D., & Vetter, C. (2011). Real-time routing with OpenStreetMap data. In *Proceedings of the 19th ACM SIGSPATIAL International Conference on Advances in Geographic Information Systems* (pp. 513–516). ACM. https://doi.org/10.1145/2093973.2094062

Moritz, H. (2000). Geodetic Reference System 1980. *Journal of Geodesy, 74*(1), 128–133. https://doi.org/10.1007/s001900050278

OpenStreetMap Foundation. (s.d.). *Tile usage policy*. Consulté le 11 novembre 2026, à l'adresse https://operations.osmfoundation.org/policies/tiles/

OpenStreetMap Wiki contributors. (s.d.). *Tag:amenity=public_bookcase*. OpenStreetMap Wiki. Consulté le 11 novembre 2026, à l'adresse https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase

Outils Tice. (2020). *Les meilleurs sites pour trouver des boîtes à livres*. https://outilstice.com/sites-pour-trouver-des-boites-a-livres/

Percival, C. (2009). *Stronger key derivation via sequential memory-hard functions* [Communication]. BSDCan'09, Ottawa, Canada. https://www.tarsnap.com/scrypt/scrypt.pdf

Région Île-de-France. (s.d.). *La carte des 100 boîtes à livres Région Île-de-France dans les gares*. Consulté le 11 novembre 2026, à l'adresse https://www.iledefrance.fr/toutes-les-actualites/la-carte-des-100-boites-livres-region-ile-de-france-dans-les-gares

Ville de Paris. (s.d.). *Où sont les boîtes à livres à Paris ?* Consulté le 11 novembre 2026, à l'adresse https://www.paris.fr/pages/ou-sont-les-boites-a-livres-a-paris-25227

---

Données cartographiques © contributeurs OpenStreetMap (ODbL). Code sous licence MIT (voir `LICENSE`).
