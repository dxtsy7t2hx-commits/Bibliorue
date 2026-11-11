# Tutoriel : mettre Bibliorue en ligne avec Supabase (faisable entièrement depuis un iPad)

Tout se fait dans **Safari**, sur trois sites : **GitHub** (où est le code), **Supabase** (où seront les données) et votre future adresse **GitHub Pages** (où sera l'application). Il n'y a rien à installer.

**Durée :** 30 à 45 minutes. **Coût :** 0 € (offres gratuites de GitHub et Supabase).

### Comment les pièces s'emboîtent
```
  Téléphone / iPad des promeneurs
            │  ouvre https://dxtsy7t2hx-commits.github.io/Bibliorue/
            ▼
  GitHub Pages ── sert les pages de l'application (HTML, CSS, JavaScript, pictogrammes)
            │  l'application demande / envoie les données
            ▼
  Supabase ── comptes (e-mail + mot de passe), base de données PostgreSQL, règles de sécurité
```

> **Petit lexique**
> - **Dépôt** : le dossier du projet sur GitHub.
> - **Branche** : une version parallèle du code. `main` est la version officielle.
> - **SQL** : le langage qui parle aux bases de données.
> - **Clé publique** (*publishable key*) : un identifiant qui permet à l'application de joindre votre projet Supabase. Elle est faite pour être visible : ce sont les règles de la base qui protègent les données, pas le secret de la clé (Supabase, s.d.-a).

---

## Étape 1 : rassembler le code sur `main` (GitHub)

Le code est sur une branche de travail, `claude/application-complete-1cy33u`. GitHub Pages publiera la branche `main` : il faut donc d'abord fusionner.

1. Dans Safari, ouvrez <https://github.com/dxtsy7t2hx-commits/Bibliorue> (connecté à votre compte).
2. Touchez **Pull requests**, puis **New pull request**.
3. Réglez les deux menus : **base: `main`** ← **compare: `claude/application-complete-1cy33u`**.
4. Touchez **Create pull request** (deux fois : la seconde valide le titre).
5. Attendez que la coche verte des tests apparaisse, puis touchez **Merge pull request** et **Confirm merge**.

> Vous pouvez aussi me demander de créer cette *pull request* (« demande de fusion »). Il ne vous restera alors que l'étape 5.

---

## Étape 2 : créer le projet Supabase

1. Allez sur <https://supabase.com/dashboard> et touchez **New project**.
2. Remplissez :
   - **Name** : `bibliorue` ;
   - **Database Password** : touchez **Generate a password**, puis **notez-le** dans un endroit sûr (gestionnaire de mots de passe de l'iPad). L'application n'en a pas besoin, mais vous pourriez en avoir besoin un jour ;
   - **Region** : choisissez une région **européenne** (Paris ou Francfort, par exemple). Vos données restent ainsi dans l'Union européenne, ce qui simplifie le respect du RGPD ;
   - laissez les autres options par défaut, en particulier la **Data API**, qui doit rester activée : c'est elle qu'utilise l'application.
3. Touchez **Create new project** et patientez une à deux minutes.

---

## Étape 3 : installer la base de données (copier-coller un script)

Le script crée les tables (profils, boîtes, livres, activité, signalements), les règles de sécurité et toutes les fonctions de l'application. Il ne supprime jamais rien : on peut le relancer sans danger.

1. **Copier le script.** Dans un nouvel onglet, ouvrez le fichier
   <https://github.com/dxtsy7t2hx-commits/Bibliorue/blob/main/supabase/migrations/20261111120000_bibliorue.sql>.
   Touchez l'icône **Copy raw file** (deux carrés superposés, au-dessus du code, à droite).
2. **Le coller.** Dans Supabase, menu de gauche, ouvrez **SQL Editor**, puis **New query**. Touchez la zone de texte, puis **Coller**.
3. Touchez **Run** (en bas à droite).
4. Le résultat attendu est **« Success. No rows returned »**.
   - Supabase peut afficher un avertissement à propos d'opérations « destructives » : il réagit au mot `drop` des lignes `drop policy if exists`, qui ne font que remplacer une règle par sa nouvelle version. Confirmez.
5. Vérification : menu **Table Editor**. Vous devez voir `books`, `boxes`, `events`, `profiles` et `reports`.

> **Variante automatique (facultative).** Votre projet Supabase est relié à GitHub. Dans **Project Settings**, puis **Integrations**, puis **GitHub**, vous pouvez indiquer comme *Working directory* `.` et activer **Deploy to production**. Les futurs scripts du dossier `supabase/migrations` s'appliqueront alors tout seuls à chaque fusion sur `main` (Supabase, s.d.-e). Le copier-coller reste la voie la plus simple et la plus sûre pour cette première installation.

---

## Étape 4 : les réglages de connexion (Authentication)

### 4a. Inscription sans e-mail de confirmation (pour démarrer)
Le service d'e-mail intégré à Supabase n'écrit qu'aux **membres de votre équipe Supabase**, et 2 e-mails par heure au maximum (Supabase, s.d.-c). Vos futurs membres ne recevraient donc **pas** l'e-mail de confirmation, et ne pourraient jamais se connecter.

Pour démarrer :
1. Menu **Authentication**, puis **Sign In / Providers** (ou **Providers**), puis **Email**.
2. **Désactivez « Confirm email »**, puis **Save**.

Les inscriptions fonctionnent alors immédiatement. La confirmation et le « mot de passe oublié » pour tous se rebrancheront à l'étape 9.

### 4b. L'adresse du site
1. Menu **Authentication**, puis **URL Configuration** (Supabase, s.d.-f).
2. **Site URL** :
   ```
   https://dxtsy7t2hx-commits.github.io/Bibliorue/
   ```
3. Dans **Redirect URLs**, touchez **Add URL** et ajoutez :
   ```
   https://dxtsy7t2hx-commits.github.io/Bibliorue/**
   ```
4. **Save**.

Ces adresses indiquent à Supabase où renvoyer les gens après un clic dans un e-mail (confirmation, nouveau mot de passe).

---

## Étape 5 : relier l'application à votre projet

1. Dans Supabase, touchez le bouton **Connect**, en haut de la page du projet (Supabase, s.d.-a). Notez :
   - l'**URL du projet**, de la forme `https://abcdefghijkl.supabase.co` ;
   - la **clé publique** (*Publishable key*), qui commence par `sb_publishable_…`.

   On les retrouve aussi dans **Project Settings**, puis **API Keys**.
2. **Option A, la plus simple : envoyez-moi ces deux valeurs** dans la conversation. Elles sont publiques par conception. Je les écris dans `js/config.js` et je mets en ligne.
3. **Option B, vous-même sur GitHub :**
   1. Ouvrez <https://github.com/dxtsy7t2hx-commits/Bibliorue/blob/main/js/config.js>.
   2. Touchez l'icône **crayon** (*Edit this file*).
   3. Remplacez `COLLEZ_ICI_L_URL_DU_PROJET` par l'URL, et `COLLEZ_ICI_LA_CLE_PUBLISHABLE` par la clé. Gardez les apostrophes `'…'` autour.
   4. Touchez **Commit changes…**, puis encore **Commit changes**.

> ⚠️ Ne mettez **jamais** dans ce fichier la clé **secrète** (`sb_secret_…` ou l'ancienne `service_role`). Elle donne tous les droits sur la base et ne doit jamais quitter Supabase.

---

## Étape 6 : publier avec GitHub Pages

1. Sur la page du dépôt GitHub, touchez **Settings** (dans le menu ⋯ sur petit écran), puis **Pages**.
2. Sous **Build and deployment**, puis **Source**, choisissez **Deploy from a branch**.
3. **Branch** : `main`, dossier **`/ (root)`**, puis **Save**.
4. Après une ou deux minutes, l'adresse s'affiche en haut de la page :
   **https://dxtsy7t2hx-commits.github.io/Bibliorue/**

Ouvrez-la. Si un bandeau rouge « Bibliorue n'est pas encore relié à Supabase » apparaît, l'étape 5 n'est pas terminée.

---

## Étape 7 : votre compte, puis devenir modérateur

1. Sur le site, touchez le **rond de compte** en haut à droite, puis **Créer un compte**. Suivez les 3 étapes : **Particulier** ou **Lieu culturel**, votre nom, puis votre e-mail et votre mot de passe.
2. Dans Supabase, retournez dans **SQL Editor**, puis **New query**. Collez la ligne suivante en mettant **votre** e-mail, puis **Run** :
   ```sql
   select public.make_admin('votre.adresse@exemple.fr');
   ```
   Réponse attendue : `OK : … est maintenant modérateur.`
3. Rechargez le site. Dans votre compte apparaît la section **Modération**, avec les signalements et le bouton de **sauvegarde**.

---

## Étape 8 : installer l'application sur l'iPad (et les téléphones)

Dans Safari, sur le site, touchez le bouton **Partager**, puis **Sur l'écran d'accueil**. Bibliorue s'ouvre ensuite en plein écran, comme une application.

**Premiers essais :**
- placer une boîte : bouton rond **+**, déplacez la carte pour mettre le repère sur la boîte, puis **C'est ici** ;
- déposer un livre ;
- lancer une **Balade** ;
- utiliser la pastille **Boîtes OSM** pour importer les boîtes déjà recensées par OpenStreetMap dans votre ville.

---

## Étape 9 (avant d'ouvrir au public) : des e-mails pour tout le monde

Pour réactiver la confirmation des adresses et le **mot de passe oublié**, branchez un service d'envoi d'e-mails (SMTP) :

1. Créez un compte chez un service d'envoi, par exemple **Brevo** (entreprise française, offre gratuite) ou Resend. Le plus fiable est d'utiliser un nom de domaine à vous (par exemple `bibliorue.fr`) pour l'adresse d'expédition.
2. Dans Supabase : **Authentication**, puis **Emails**, puis **SMTP Settings**, puis **Enable custom SMTP**. Recopiez l'hôte, le port, l'identifiant et le mot de passe fournis par le service.
3. Réactivez **Confirm email** (étape 4a).

Je peux vous guider pas à pas le moment venu.

---

## Au quotidien

| Besoin | Où |
|---|---|
| Voir les signalements, sauvegarder | Site, puis votre compte, puis **Modération** |
| Sauvegarde complète (JSON) | Bouton **Télécharger une sauvegarde complète**. L'offre gratuite de Supabase ne fait pas de sauvegarde automatique (Supabase, s.d.-d) : faites-en une **chaque semaine** et rangez-la dans Fichiers ou iCloud. |
| Projet « en pause » | Un projet gratuit est mis en pause après **7 jours sans activité** (Supabase, s.d.-b). Les données sont conservées. Dans le tableau de bord Supabase, touchez **Restore project**. |
| Corriger / supprimer une boîte | Ouvrez sa fiche : en tant que modérateur, vous voyez **Modifier** et **Supprimer** partout. |
| Nommer un autre modérateur | Étape 7.2, avec son e-mail. |

## Si quelque chose ne marche pas

| Symptôme | Cause probable | Solution |
|---|---|---|
| Bandeau rouge « pas encore relié à Supabase » | `js/config.js` n'est pas rempli. | Étape 5. |
| « Connexion impossible » partout | URL ou clé mal recopiée, ou projet en pause. | Revérifiez l'étape 5 ; regardez si le projet est en pause. |
| « Could not find the function… » | Le script de l'étape 3 n'a pas été exécuté sur **ce** projet. | Refaites l'étape 3. |
| Inscription « réussie » mais connexion impossible (« Confirmez d'abord votre adresse ») | « Confirm email » est encore activé sans SMTP. | Étape 4a. |
| La page GitHub Pages affiche « 404 » | Pages n'est pas activé, ou le code n'est pas sur `main`. | Étapes 1 et 6. Attendez deux minutes après l'activation. |
| Le site n'affiche pas les dernières modifications | Ancienne version gardée en mémoire. | Fermez l'onglet, rouvrez-le ; au besoin, rechargez deux fois. |

---

## Sources

Supabase. (s.d.-a). *API keys*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/api/api-keys

Supabase. (s.d.-b). *Pricing*. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/pricing

Supabase. (s.d.-c). *Send emails with custom SMTP*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/auth/auth-smtp

Supabase. (s.d.-d). *Database backups*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/platform/backups

Supabase. (s.d.-e). *GitHub integration*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/deployment/branching/github-integration

Supabase. (s.d.-f). *Redirect URLs*. Supabase Docs. Consulté le 11 novembre 2026, à l'adresse https://supabase.com/docs/guides/auth/redirect-urls
