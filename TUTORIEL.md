# Tutoriel : lancer Bibliorue, de votre ordinateur jusqu'à Internet

Ce guide s'adresse à quelqu'un qui n'a **jamais lancé d'application web**. Il y a deux étapes, dans cet ordre :

| Étape | À quoi ça sert | Durée | Coût |
|---|---|---|---|
| **A. Essayer sur votre ordinateur** | Voir l'application tourner, la tester, sans risque. Vous seul y avez accès. | 15 min | Gratuit |
| **B. Mettre en ligne** | Obtenir une adresse web publique (`https://…`) que tout le monde peut ouvrir, y compris sur téléphone. | 20 min | Gratuit pour un petit essai, environ 5 $/mois ensuite (voir B.7) |

> **Pourquoi un serveur ?** Bibliorue est une carte *partagée* : quand Camille ajoute une boîte, Léo doit la voir. Il faut donc un ordinateur allumé en permanence (un **serveur**) qui garde les données communes dans une **base de données** (ici un seul fichier, `bibliorue.db`). À l'étape A, ce serveur est votre propre ordinateur. À l'étape B, c'est un ordinateur loué chez un **hébergeur**.

---

## Petit lexique

- **Terminal** : fenêtre où l'on tape des commandes au lieu de cliquer. Sur Mac, l'application s'appelle *Terminal* ; sur Windows, *Terminal* ou *PowerShell*.
- **Commande** : ligne de texte tapée dans le terminal, validée avec la touche Entrée. Dans ce guide, elles sont dans des blocs gris comme celui-ci :
  ```
  node --version
  ```
- **Node.js** : le moteur qui fait tourner le serveur de Bibliorue (le serveur est écrit en JavaScript).
- **Dépôt (GitHub)** : le dossier en ligne qui contient tout le code, avec son historique.
- **Branche** : une version parallèle du code. Tout le travail est sur la branche `claude/application-complete-1cy33u`. La version « officielle » s'appelle `main`.
- **Variable d'environnement** : un réglage passé à l'application sans toucher au code, par exemple l'e-mail du modérateur.

---

## Étape 0 : rassembler le code sur la branche `main` (recommandé)

Pour l'instant, le code est sur une branche de travail. Le plus simple est de le **fusionner** dans `main` : c'est la version que les hébergeurs prennent par défaut.

1. Ouvrez <https://github.com/dxtsy7t2hx-commits/bibliorue> en étant connecté à GitHub.
2. Un bandeau jaune propose *« claude/application-complete-1cy33u had recent pushes — Compare & pull request »*. Cliquez sur **Compare & pull request**.
   - Si le bandeau n'apparaît pas : onglet **Pull requests**, puis **New pull request**. Choisissez `base: main` et `compare: claude/application-complete-1cy33u`.
3. Cliquez sur **Create pull request**, puis sur **Merge pull request** et **Confirm merge**.

> Une **pull request** (« demande de fusion ») présente les changements d'une branche avant de les intégrer à `main`. Vous pouvez aussi me demander de la créer pour vous.

---

## Étape A : essayer Bibliorue sur votre ordinateur

### A.1 Installer Node.js (une seule fois)
1. Allez sur <https://nodejs.org>.
2. Téléchargez la version marquée **LTS** (*Long Term Support*, la version stable maintenue plusieurs années).
3. Installez-la comme n'importe quel logiciel : double-clic, puis Suivant, Suivant, Terminer.
4. Vérifiez l'installation. Ouvrez un terminal :
   - **Mac** : touches `Cmd + Espace`, tapez « Terminal », puis Entrée ;
   - **Windows** : touche Windows, tapez « Terminal », puis Entrée.

   Tapez ensuite :
   ```
   node --version
   ```
   Il doit s'afficher un numéro comme `v24.11.0`. **Il faut au moins `v22.13`** : Bibliorue utilise la base de données SQLite intégrée à Node.js, qui n'existe pas dans les versions plus anciennes.

### A.2 Télécharger le code
1. Sur la page GitHub du dépôt, cliquez sur le bouton vert **Code**, puis **Download ZIP**.
   - Si vous n'avez pas fait l'étape 0, choisissez d'abord la branche `claude/application-complete-1cy33u` dans le menu des branches (en haut à gauche, il indique `main`).
2. Décompressez le fichier ZIP, par exemple dans *Documents*. Vous obtenez un dossier `bibliorue-main` (ou un nom proche).

### A.3 Ouvrir un terminal « dans » ce dossier
Les commandes doivent s'exécuter depuis le dossier de Bibliorue.

- **Mac** : dans le Terminal, tapez `cd ` (avec un espace après), **glissez le dossier** depuis le Finder dans la fenêtre du Terminal, puis appuyez sur Entrée.
- **Windows** : ouvrez le dossier dans l'Explorateur, faites un clic droit dans un espace vide, puis **Ouvrir dans le Terminal**.

Pour vérifier, tapez `ls` (Mac) ou `dir` (Windows). Vous devez voir `index.html`, `server`, `package.json`, etc.

### A.4 Créer votre fichier de réglages `.env`
Le fichier `.env.example` est un modèle. Copiez-le sous le nom `.env` :

- **Mac** :
  ```
  cp .env.example .env
  ```
- **Windows** :
  ```
  copy .env.example .env
  ```

Ouvrez ensuite `.env` avec un éditeur de texte (TextEdit, Bloc-notes…). Complétez la ligne des modérateurs avec **votre** e-mail :
```
ADMIN_EMAILS=votre.adresse@exemple.fr
```

> Sur Mac, les fichiers dont le nom commence par un point sont cachés dans le Finder. Pour les afficher : `Cmd + Maj + .`.
>
> Le fichier `.env` reste sur votre ordinateur : il est exclu de GitHub (via `.gitignore`).

### A.5 Lancer
```
npm start
```
Le message suivant doit apparaître :
```
Bibliorue écoute sur http://localhost:8080
```
Ouvrez <http://localhost:8080> dans votre navigateur. `localhost` signifie « cet ordinateur-ci ».

**Laissez le terminal ouvert** : si vous le fermez, le serveur s'arrête. Pour l'arrêter volontairement, appuyez sur `Ctrl + C` dans le terminal.

### A.6 Premiers pas
1. Cliquez sur **Connexion**, puis **Créer un compte**, **avec l'e-mail mis dans `ADMIN_EMAILS`**. Ce compte sera modérateur : il voit les signalements et peut corriger ou supprimer n'importe quelle boîte.
2. Cliquez sur **Ajouter une boîte**, puis touchez la carte : votre première bibliothèque de rue apparaît en bleu.
3. Pour tester un **lieu culturel** : créez un second compte de type « Lieu culturel », dans une fenêtre de navigation privée pour ne pas être déconnecté du premier. Son lieu apparaîtra en rouge brique.
4. Essayez l'onglet **Balade**.

Les données sont enregistrées dans `data/bibliorue.db`. Pour **tout remettre à zéro**, arrêtez le serveur (`Ctrl + C`), supprimez le dossier `data`, puis relancez `npm start`.

### A.7 (Facultatif) Lancer les tests automatiques
```
npm test
```
Les 28 tests doivent afficher `pass 28` et `fail 0`. Ils vérifient les comptes, les droits, les doublons, la balade, etc.

### A.8 Problèmes fréquents

| Message | Cause | Solution |
|---|---|---|
| `node` / `npm` *n'est pas reconnu* ou *command not found* | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation. | Fermez et rouvrez le terminal ; sinon, refaites A.1. |
| `No such built-in module: node:sqlite` ou `bad option: --env-file-if-exists` | Node.js est trop ancien. | Installez la version LTS actuelle (A.1). |
| `EADDRINUSE` | Le port 8080 est déjà utilisé par un autre programme, ou par un Bibliorue déjà lancé. | Fermez l'autre terminal, ou mettez `PORT=8081` dans `.env` puis ouvrez `http://localhost:8081`. |
| `ENOENT … package.json` | Le terminal n'est pas dans le dossier de Bibliorue. | Refaites A.3. |
| « Me localiser » ne fait rien | Le navigateur bloque la position. | Autorisez la localisation pour `localhost` (icône à gauche de l'adresse). |

> **Et sur mon téléphone ?** En local, le téléphone ne peut pas utiliser la géolocalisation ni la caméra : les navigateurs exigent une connexion chiffrée HTTPS, sauf pour `localhost`. Pour tester sur téléphone, passez à l'étape B.

---

## Étape B : mettre Bibliorue en ligne avec Railway

**Railway** est un hébergeur qui lit le code directement depuis GitHub, le construit et le met en ligne avec une adresse HTTPS. Je le recommande pour trois raisons :
- il se pilote entièrement à la souris ;
- il comprend le fichier `Dockerfile` de Bibliorue (la « recette » qui décrit comment installer l'application) ;
- il propose des **volumes**, c'est-à-dire des disques durables. Sans volume, la base de données serait effacée à chaque mise à jour.

> Les intitulés des boutons de Railway peuvent changer légèrement avec le temps. En cas de doute, la documentation officielle est sur <https://docs.railway.com>.

### B.1 Créer un compte
Allez sur <https://railway.com> et inscrivez-vous **avec votre compte GitHub** : cela relie les deux services. Autorisez Railway à accéder au dépôt `bibliorue`.

### B.2 Créer le projet depuis GitHub
1. Cliquez sur **New Project**, puis **GitHub Repository** (ou *Deploy from GitHub repo*).
2. Choisissez `bibliorue`.
3. Choisissez **Add variables** plutôt que *Deploy Now* : il faut d'abord régler l'application.

Railway détecte seul le `Dockerfile`. Il doit être à la racine du dépôt, avec un D majuscule, ce qui est le cas (Railway, s.d.-b).

### B.3 Renseigner les variables
Dans l'onglet **Variables** du service, ajoutez :

| Nom | Valeur | Pourquoi |
|---|---|---|
| `ADMIN_EMAILS` | `votre.adresse@exemple.fr` | Votre compte sera modérateur. |
| `TRUST_PROXY` | `1` | Railway place un intermédiaire (*proxy*) devant l'application. Ce réglage permet de lire la vraie adresse des visiteurs, utile pour limiter les tentatives de connexion abusives. |
| `RAILWAY_RUN_UID` | `0` | Les volumes Railway appartiennent à l'administrateur du système (*root*), alors que Bibliorue s'exécute par sécurité avec un utilisateur restreint. Cette variable lui donne le droit d'écrire sur le volume (Railway, s.d.-c). |

N'ajoutez **pas** `PORT` : Railway le fournit lui-même. `DATABASE_PATH` est déjà réglé sur `/data/bibliorue.db` dans le `Dockerfile`.

**Si vous n'avez pas fusionné dans `main` (étape 0)** : dans les réglages du service (**Settings**), choisissez `claude/application-complete-1cy33u` comme branche de déclenchement (*trigger branch*) (Railway, s.d.-e).

### B.4 Ajouter le volume (le disque qui garde les données)
1. Sur le canevas du projet (la zone où apparaît la carte du service), faites un **clic droit**, puis **Volume**. Vous pouvez aussi passer par la palette de commandes : `Cmd + K` sur Mac, `Ctrl + K` sur Windows.
2. Reliez-le au service Bibliorue.
3. Comme **chemin de montage** (*mount path*), indiquez exactement :
   ```
   /data
   ```

> N'utilisez pas `/app` : c'est là que se trouve le code de l'application. Un volume monté à cet endroit le masquerait et empêcherait le démarrage.

### B.5 Déployer et obtenir l'adresse
1. Cliquez sur **Deploy** (en haut du canevas). La construction prend une à deux minutes.
2. Dans l'onglet **Deployments**, puis **View logs**, la ligne `Bibliorue écoute sur http://localhost:8080` indique que tout va bien. Ce texte parle de `localhost` parce qu'il est écrit depuis l'intérieur du serveur ; c'est normal.
3. Dans **Settings**, puis **Networking**, cliquez sur **Generate Domain**. Si Railway demande un port, indiquez celui des journaux (en principe `8080`).
4. Vous obtenez une adresse du type `https://bibliorue-production.up.railway.app`. **C'est celle à partager.** Le HTTPS est fourni automatiquement.

### B.6 Vérifier
1. Ouvrez l'adresse, créez votre compte avec l'e-mail de `ADMIN_EMAILS`, puis ajoutez une boîte.
2. **Redéployez** (dans *Deployments*, menu ⋮, puis *Redeploy*) et vérifiez que la boîte est toujours là. Si elle a disparu, le volume n'est pas monté sur `/data` : revoyez B.4.
3. Sur votre téléphone, ouvrez l'adresse et installez l'application :
   - **Android** : menu ⋮, puis **Installer l'application** ;
   - **iPhone** : bouton Partager, puis **Sur l'écran d'accueil**.

### B.7 Combien ça coûte ?
D'après la page des offres de Railway (Railway, s.d.-a), consultée le 11 novembre 2026. **Vérifiez-la avant de vous engager, car les prix évoluent.**

| Offre | Prix | Crédit d'utilisation inclus | Taille maximale d'un volume |
|---|---|---|---|
| Free | 0 $ | 1 $ par mois | 0,5 Go |
| Trial (essai) | — | 5 $, une seule fois | 0,5 Go |
| Hobby | 5 $ par mois | 5 $ par mois | 5 Go |
| Pro | 20 $ par mois | 20 $ par mois | jusqu'à 1 To |

Le « crédit d'utilisation » couvre le temps de calcul et la mémoire réellement consommés. Ces offres sont libellées en dollars américains.

**Ordre de grandeur pour Bibliorue :**
- 0,5 Go suffit pour **des dizaines de milliers de boîtes et de livres**, car seuls des textes sont stockés et la base fait quelques Mo ;
- l'offre **Hobby** est la plus adaptée à un service public qui doit rester allumé.

### B.8 Mettre à jour l'application
Chaque nouvelle version poussée sur la branche suivie par Railway (`main` en principe) est **reconstruite et remise en ligne automatiquement**. Pour cela, il suffit que votre compte GitHub soit relié au projet (Railway, s.d.-e). Les données du volume sont conservées.

### B.9 Sauvegarder les données
Les services dotés d'un volume peuvent être sauvegardés à la main ou automatiquement (Railway, s.d.-c). Ouvrez le volume, onglet **Backups**, et activez une sauvegarde régulière, par exemple quotidienne. **Faites-le avant d'annoncer le site.**

### B.10 (Facultatif) Votre propre nom de domaine
Pour une adresse comme `bibliorue.fr`, achetez le nom chez un registraire (OVHcloud, Gandi…). Ajoutez-le ensuite dans **Settings**, puis **Networking**, puis **Custom Domain**, et suivez les instructions DNS affichées.

> Le **DNS** est l'annuaire d'Internet : il associe un nom lisible à l'adresse technique du serveur.

---

## Autres façons d'héberger

- **Un serveur loué (VPS)**, chez OVHcloud, Scaleway, Hetzner… Avec Docker installé, deux commandes suffisent :
  ```
  docker build -t bibliorue .
  docker run -d -p 8080:8080 -v bibliorue-data:/data -e ADMIN_EMAILS=vous@exemple.fr -e TRUST_PROXY=1 bibliorue
  ```
  Il faut ensuite placer devant un serveur HTTPS, comme Caddy ou Nginx. C'est plus technique, mais aussi plus économique et sous votre contrôle total.
- **Fly.io** ou **Render** fonctionnent aussi, à condition d'ajouter un disque persistant. Chez Render, le disque n'est proposé que sur les offres payantes.

---

## Avant d'annoncer le site au public : la liste

- [ ] Sauvegardes automatiques activées (B.9).
- [ ] Au moins un modérateur (`ADMIN_EMAILS`) qui s'est inscrit.
- [ ] **Mentions légales** et **politique de confidentialité** publiées. Le site conserve des e-mails, donc le RGPD (règlement général sur la protection des données) s'applique. La CNIL, l'autorité française de protection des données, propose un guide de démarrage (CNIL, s.d.).
- [ ] Quelques boîtes déjà placées dans votre ville, pour que les premiers visiteurs ne trouvent pas une carte vide. Le bouton **Boîtes OSM** permet d'importer celles déjà recensées par OpenStreetMap.
- [ ] Prévoir, dans une prochaine version, la récupération de mot de passe : elle demande un service d'envoi d'e-mails.

---

## Sources

CNIL. (s.d.). *RGPD : par où commencer*. Consulté le 11 novembre 2026, à l'adresse https://www.cnil.fr/fr/rgpd-par-ou-commencer

OpenJS Foundation. (s.d.). *Node.js releases*. Consulté le 11 novembre 2026, à l'adresse https://nodejs.org/en/about/previous-releases

Railway. (s.d.-a). *Pricing plans*. Railway Docs. Consulté le 11 novembre 2026, à l'adresse https://docs.railway.com/pricing/plans

Railway. (s.d.-b). *Dockerfiles*. Railway Docs. Consulté le 11 novembre 2026, à l'adresse https://docs.railway.com/builds/dockerfiles

Railway. (s.d.-c). *Volumes*. Railway Docs. Consulté le 11 novembre 2026, à l'adresse https://docs.railway.com/volumes

Railway. (s.d.-d). *Quick start*. Railway Docs. Consulté le 11 novembre 2026, à l'adresse https://docs.railway.com/quick-start

Railway. (s.d.-e). *GitHub autodeploys*. Railway Docs. Consulté le 11 novembre 2026, à l'adresse https://docs.railway.com/deployments/github-autodeploys
