# Bibliorue

**Bibliorue** est une **carte communautaire des bibliothèques de rue**. Tout le monde peut la consulter. Les membres inscrits y ajoutent les boîtes qu'ils connaissent et les livres qu'ils y voient. L'application **propose aussi des balades** qui vont de boîte en boîte, selon le temps dont on dispose.

Les **lieux culturels** (bibliothèques, médiathèques, librairies, cafés-livres, associations…) peuvent s'inscrire comme tels. Ils apparaissent alors **en rouge brique** sur la carte, et les promeneurs peuvent les inclure dans leur balade.

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
| 🗺️ **Carte partagée** | Visible sans compte. Code couleur : tampon bleu : bibliothèque de rue · tampon rouge brique : lieu culturel · tampon beige à bord pointillé : boîte recensée dans OSM mais pas encore sur Bibliorue · rond bleu étoilé : vous. |
| 👤 **Comptes** | Obligatoires pour ajouter une boîte ou un livre, indiquer qu'on prend un livre, ou signaler un contenu. Deux types d'inscription : **Particulier** ou **Lieu culturel** (avec le type de lieu et un site web). |
| 🏛️ **Lieux culturels** | Seul un compte « lieu culturel » peut placer un lieu rouge brique. La règle est vérifiée par le serveur, pas seulement par l'interface. Sa fiche affiche le type de lieu, ses horaires et son site. |
| ➕ **Ajout de boîte** | On touche la carte à l'emplacement exact de la boîte. Le serveur **refuse les doublons** : une autre boîte à moins de 15 m, ou le même identifiant OSM. |
| 📚 **Livres** | Dépôt, avec fiche remplie automatiquement à partir de l'ISBN via Open Library, ou par scan du code-barres. Puis « Je le prends », « Je le redépose ici », « N'y est plus ». |
| 🚶 **Balade** | On choisit son temps disponible (30 min à 4 h), une boucle ou un aller simple, et si l'on inclut les lieux culturels. Bibliorue choisit les étapes, les ordonne et trace l'itinéraire piéton réel. La balade s'ouvre ensuite dans une application GPS. |
| 🔎 **Recherche** | Un livre précis, dans toutes les boîtes, trié par distance. |
| 🤝 **Communauté** | Statistiques et fil des dernières contributions. |
| ⚑ **Modération** | Tout membre peut signaler un contenu. Les modérateurs (nommés par `select public.make_admin('e-mail')` dans Supabase) voient les signalements, peuvent corriger ou supprimer n'importe quelle boîte et téléchargent une sauvegarde complète. |
| 📤 **Données ouvertes** | Export public de la carte en GeoJSON (bouton dans l'onglet Communauté), sans aucune donnée personnelle. |
| ✈️ **Hors ligne** | L'interface et la dernière carte consultée restent disponibles sans réseau. |

### Comment la balade est calculée
Il s'agit de visiter le plus de boîtes intéressantes dans un temps limité. En recherche opérationnelle (la discipline mathématique de l'optimisation), c'est le **problème d'orientation** (*orienteering problem*, Golden et al., 1987).

Ce problème est **NP-difficile** : aucune méthode connue ne garantit la meilleure solution en un temps raisonnable dès qu'il y a beaucoup de points. On utilise donc une **heuristique**, c'est-à-dire une méthode rapide qui donne une très bonne solution sans prouver qu'elle est la meilleure :

1. **Insertion la moins coûteuse.** On ajoute à chaque fois la boîte qui apporte le plus d'intérêt pour le moins de minutes supplémentaires. L'intérêt est plus élevé si la boîte contient des livres ou s'il s'agit d'un lieu culturel.
2. **Amélioration « 2-opt »** (Croes, 1958). On inverse des portions du parcours tant que cela le raccourcit. Résultat : un tracé sans croisements.
3. **Nouvel essai d'insertion** avec le temps ainsi libéré.

Les temps sont d'abord estimés à vol d'oiseau, avec une marche à 4,5 km/h, un facteur de détour de 1,3 et 5 min par arrêt. L'itinéraire réel dans les rues est ensuite demandé au moteur **OSRM** (Luxen & Vetter, 2011), sur le serveur public de l'association FOSSGIS. Le code est dans `js/route.js`.

### Direction artistique et interface
**Palette restreinte** : bleu cobalt `#1f46c6` pour les bibliothèques de rue, rouge brique `#b0472c` pour les lieux culturels, papier `#efe7d8`, encre bleu nuit `#18204a`. Elle est déclinée en thème sombre.

**Typographie « affiche »** : **Lilita One** (Montoreano, 2011), en capitales et en très grand corps pour les titres ; **Nunito** (Nunito Project Authors, 2014) pour le texte. Les deux polices sont hébergées dans l'application (SIL OFL 1.1).

**Pictogrammes** dessinés pour le projet, en aplats aux contours vectoriels nets. Ils servent aussi d'éléments graphiques, en grand, dans les blocs de couleur. Il n'y a ni étoiles ni illustrations dessinées.

**Principes d'interface** (tendances 2026 : actions dans le tiers inférieur de l'écran, gestes, micro-interactions, typographie surdimensionnée) :
- **carte plein écran**, avec une **feuille coulissante** : on la tire vers le haut ou on la replie. Elle contient des **cartes colorées à faire glisser** latéralement ;
- **filtres** en pastilles (Rue, Lieux culturels, Avec des livres, Boîtes OSM) et boutons flottants à portée de pouce ;
- **placement d'une boîte par repère fixe** : on déplace la carte sous le repère, plus précis au doigt qu'un toucher ;
- **fiche plein écran** avec un grand en-tête coloré et une **étagère de livres à faire défiler**. Quand un livre n'a pas de couverture, l'application en compose une ;
- **balade et inscription en étapes numérotées** (01, 02, 03), avec des choix sous forme de grosses pastilles ;
- **accueil en trois écrans à faire glisser** à la première visite ;
- **dégradés granuleux** sur les blocs bleus et brique, **apparition au défilement** (*scroll-driven animations*) et **transitions entre pages** (*View Transitions*) quand le navigateur les gère. Ces animations sont désactivées si l'utilisateur a demandé moins d'animations dans son système.

---

## 3. Architecture et mise en ligne

> 👉 **Guide pas à pas, faisable depuis un iPad : [TUTORIEL.md](TUTORIEL.md).**

```
navigateur ──► GitHub Pages (fichiers de l'application : HTML, CSS, JS, polices, pictogrammes)
     │
     └──────► Supabase : Auth (comptes) + PostgreSQL (données) + règles de sécurité
```

- **Il n'y a pas de serveur à gérer.** L'application est un ensemble de fichiers statiques, publiés gratuitement par **GitHub Pages**.
- **Supabase** fournit la base de données PostgreSQL et la gestion des comptes : inscription, connexion, confirmation d'e-mail, mot de passe oublié.
- **Toute la logique sensible est dans la base de données**, dans le fichier `supabase/migrations/20261111120000_bibliorue.sql` :
  - les tables sont protégées par la **sécurité au niveau des lignes** (*Row Level Security*, RLS : la base vérifie elle-même, ligne par ligne, qui peut lire ou écrire). Tout le monde peut lire la carte ; **personne ne peut écrire directement dans les tables** ;
  - les écritures passent par des **fonctions SQL** (`add_box`, `add_book`, `change_book`, `report`…). Chacune vérifie l'identité du membre (`auth.uid()`), ses droits, les doublons et la limite d'actions ;
  - les droits d'exécution de chaque fonction sont accordés un par un.
- **Le navigateur ne détient qu'une clé publique** (*publishable key*), faite pour être visible (Supabase, s.d.-a).

L'ancienne version, avec un serveur Node.js et SQLite, reste disponible dans l'historique Git (commit `bbf43a0`).

### Essayer en local (sur un ordinateur)
```bash
npm start        # petit serveur de fichiers sur http://localhost:8080
```
Il faut d'abord renseigner `js/config.js` avec l'URL et la clé publique d'un projet Supabase.

### Tests
```bash
npm test
```
- **Tests de la base** (`tests/supabase.test.js`). Ils utilisent la **vraie bibliothèque supabase-js**. Elle dialogue avec une imitation de Supabase (`tests/fake-supabase.mjs`), qui exécute le **script SQL réel** dans un PostgreSQL local. Les règles de sécurité, les inscriptions, les doublons, les livres, la modération, la limite d'actions et la suppression de compte sont ainsi vérifiés. Ces tests sont ignorés si aucun PostgreSQL n'est disponible.
- **Tests des modules** : ISBN, distances, OpenStreetMap, Open Library, algorithme de balade.
- Sur GitHub, l'intégration continue lance tous ces tests avec un PostgreSQL 16 (`.github/workflows/ci.yml`).

---

## 4. Organisation du code

```
index.html, css/            interface (mobile d'abord, thème sombre automatique, pictogrammes SVG intégrés)
js/app.js                   logique de l'interface (carte Leaflet, fiches, balade, compte)
js/api.js                   accès aux données via Supabase (fonctions SQL « RPC »)
js/config.js                URL et clé publique du projet Supabase (à remplir)
js/route.js                 conseiller de balade + itinéraire OSRM
js/geo.js, isbn.js, overpass.js, openlibrary.js   modules utilitaires
vendor/                     bibliothèque supabase-js 2.118.0 (licence MIT), servie avec l'application
supabase/migrations/        script d'installation de la base (tables, RLS, fonctions)
fonts/                      polices Lilita One et Nunito (woff2) + licences OFL
sw.js, manifest.webmanifest application installable, interface disponible hors ligne
scripts/serve.mjs           serveur de fichiers pour les essais locaux
tests/                      tests automatiques (node:test)
```

### Sécurité et vie privée
- **Comptes gérés par Supabase Auth.** Les mots de passe y sont hachés (transformés de façon irréversible) et ne transitent jamais par nos fichiers.
- **Écritures uniquement via des fonctions contrôlées.** Les droits directs d'insertion, de modification et de suppression sont retirés aux rôles publics. Les signalements sont illisibles hors modération.
- **Règles métier vérifiées par la base**, et non par l'interface :
  - seuls les comptes « lieu culturel » créent des lieux culturels ;
  - seul l'auteur ou un modérateur modifie une boîte ;
  - refus d'une boîte à moins de 15 m d'une autre ;
  - 60 actions par minute au maximum par membre.
- **Politique de sécurité du contenu** (CSP, *Content Security Policy*), déclarée dans la page : elle limite les sites que l'application a le droit de contacter.
- **Textes affichés systématiquement échappés**, contre l'injection de code (XSS).
- **L'e-mail n'est jamais public**, ni dans la carte, ni dans l'export, ni dans la sauvegarde.
- **Droit à l'effacement** (RGPD, art. 17) : « Supprimer mon compte » (après une nouvelle saisie du mot de passe) efface le compte. Les boîtes et livres ajoutés restent sur la carte commune, sans nom.

---

## 5. À faire avant une ouverture au public

1. **Mentions légales et politique de confidentialité.** Le site conserve des e-mails : le RGPD s'applique. Il faut indiquer qui est responsable du traitement, à quoi servent les données et combien de temps on les garde (CNIL, s.d.).
2. **Brancher un service d'envoi d'e-mails (SMTP).** La confirmation d'adresse et le « mot de passe oublié » sont prêts dans l'application. Mais le service d'e-mail intégré de Supabase n'écrit qu'aux membres de l'équipe du projet, à raison de 2 e-mails par heure (Supabase, s.d.-c). Voir TUTORIEL.md, étape 9.
3. **Sauvegardes régulières.** L'offre gratuite de Supabase n'en fait pas automatiquement (Supabase, s.d.-d) : utilisez le bouton de sauvegarde de la section Modération.
4. **Vérification des lieux culturels.** Aujourd'hui, l'inscription « lieu culturel » est déclarative : n'importe qui peut cocher la case. Un badge « vérifié », attribué par un modérateur, éviterait les usurpations.
5. **Photos des boîtes**, très utiles pour les reconnaître sur place. Le stockage de fichiers de Supabase s'y prête ; il faudra aussi modérer les images.
6. **Contribution en retour à OpenStreetMap.** Les boîtes ajoutées ici n'y sont pas envoyées automatiquement.
7. **Montée en charge.** Les serveurs publics Overpass, OSRM et les tuiles OSM sont gérés par des bénévoles et ont des règles d'usage (OpenStreetMap Foundation, s.d.). Avec beaucoup d'utilisateurs, il faudra un fournisseur de tuiles et d'itinéraires dédié.

---

## 6. Sources (APA 7)

CNIL. (s.d.). *RGPD : par où commencer*. Consulté le 11 novembre 2026, à l'adresse https://www.cnil.fr/fr/rgpd-par-ou-commencer

Croes, G. A. (1958). A method for solving traveling-salesman problems. *Operations Research, 6*(6), 791–812. https://doi.org/10.1287/opre.6.6.791

data.gouv.fr. (s.d.). *Boîtes à livres* [Jeu de données]. Consulté le 11 novembre 2026, à l'adresse https://data.gouv.fr/en/datasets/boites-a-livres

Golden, B. L., Levy, L., & Vohra, R. (1987). The orienteering problem. *Naval Research Logistics, 34*(3), 307–318. https://doi.org/10.1002/1520-6750(198706)34:3<307::AID-NAV3220340302>3.0.CO;2-D

Internet Archive. (s.d.). *Open Library Books API*. Consulté le 11 novembre 2026, à l'adresse https://openlibrary.org/dev/docs/api/books

Little Free Library. (s.d.). *History*. Consulté le 11 novembre 2026, à l'adresse https://littlefreelibrary.org/history/

Montoreano, J. (2011). *Lilita One* [Police de caractères, SIL Open Font License 1.1]. Google Fonts. https://fonts.google.com/specimen/Lilita+One

Luxen, D., & Vetter, C. (2011). Real-time routing with OpenStreetMap data. In *Proceedings of the 19th ACM SIGSPATIAL International Conference on Advances in Geographic Information Systems* (pp. 513–516). ACM. https://doi.org/10.1145/2093973.2094062

Moritz, H. (2000). Geodetic Reference System 1980. *Journal of Geodesy, 74*(1), 128–133. https://doi.org/10.1007/s001900050278

Nunito Project Authors. (2014). *Nunito* [Police de caractères, SIL Open Font License 1.1]. Google Fonts. https://fonts.google.com/specimen/Nunito

OpenStreetMap Foundation. (s.d.). *Tile usage policy*. Consulté le 11 novembre 2026, à l'adresse https://operations.osmfoundation.org/policies/tiles/

OpenStreetMap Wiki contributors. (s.d.). *Tag:amenity=public_bookcase*. OpenStreetMap Wiki. Consulté le 11 novembre 2026, à l'adresse https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase

Outils Tice. (2020). *Les meilleurs sites pour trouver des boîtes à livres*. https://outilstice.com/sites-pour-trouver-des-boites-a-livres/

Région Île-de-France. (s.d.). *La carte des 100 boîtes à livres Région Île-de-France dans les gares*. Consulté le 11 novembre 2026, à l'adresse https://www.iledefrance.fr/toutes-les-actualites/la-carte-des-100-boites-livres-region-ile-de-france-dans-les-gares

Supabase. (s.d.-a). *API keys*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/api/api-keys

Supabase. (s.d.-b). *Row Level Security*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/database/postgres/row-level-security

Supabase. (s.d.-c). *Send emails with custom SMTP*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/auth/auth-smtp

Supabase. (s.d.-d). *Database backups*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/platform/backups

Ville de Paris. (s.d.). *Où sont les boîtes à livres à Paris ?* Consulté le 11 novembre 2026, à l'adresse https://www.paris.fr/pages/ou-sont-les-boites-a-livres-a-paris-25227

---

Données cartographiques © contributeurs OpenStreetMap (ODbL). Code sous licence MIT (voir `LICENSE`).
