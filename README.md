# BudgetBacker — app mobile Android

Projet React (Vite) + Capacitor prêt à être compilé en `.apk`, de deux façons
au choix : **GitHub Actions** (dans le cloud, rien à installer) ou
**Android Studio** (en local).

## Option A — Compiler via GitHub Actions (recommandé, rien à installer)

### 1. Mettre le projet sur GitHub

1. Crée un nouveau dépôt **vide** sur https://github.com/new (ne coche ni
   README ni .gitignore).
2. Dans un terminal, à la racine de ce dossier :

```bash
git init
git add .
git commit -m "Premier import"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/TON-DEPOT.git
git push -u origin main
```

### 2. Récupérer l'APK compilé

1. Sur GitHub, ouvre l'onglet **Actions** de ton dépôt.
2. Le workflow **"Build APK"** se lance automatiquement après le push
   (~3-5 min). S'il ne démarre pas, clique dessus puis **"Run workflow"**.
3. Une fois terminé (coche verte ✅), ouvre l'exécution, descends jusqu'à
   **Artifacts** et télécharge `budgetbacker-debug-apk` (un `.zip` contenant
   `app-debug.apk`).
4. Transfère `app-debug.apk` sur ton téléphone (câble, Drive, WhatsApp…),
   ouvre le fichier, autorise l'installation depuis "cette source" si
   demandé (Réglages > Sécurité, selon la version d'Android).

## Option B — Compiler via Android Studio (en local)

### 1. Installer les prérequis

- [Node.js](https://nodejs.org) (version 18 ou plus).
- [Android Studio](https://developer.android.com/studio) — installe aussi le
  SDK Android proposé pendant son installation (fait automatiquement au
  premier lancement).

### 2. Ouvrir le projet

Dans un terminal, à la racine de ce dossier :

```bash
npm install
npm run build
npx cap sync android
npx cap open android
```

La dernière commande ouvre le dossier `android/` directement dans Android
Studio (patiente pendant l'indexation/synchronisation Gradle la première
fois — plusieurs minutes).

### 3. Générer l'APK

Dans Android Studio : menu **Build > Build Bundle(s) / APK(s) > Build
APK(s)**. Une fois terminé, une notification en bas à droite propose
**"locate"** pour ouvrir le dossier contenant `app-debug.apk`
(généralement `android/app/build/outputs/apk/debug/`).

### 4. Installer sur ton téléphone

- Soit tu branches ton téléphone en USB (mode débogage activé) et cliques
  sur ▶️ **Run** dans Android Studio pour l'installer directement.
- Soit tu transfères le fichier `app-debug.apk` sur le téléphone comme dans
  l'option A ci-dessus.

### Si tu modifies le code plus tard

Après toute modification de `src/BudgetTracker.jsx`, relance :

```bash
npm run build && npx cap sync android
```

avant de rebuilder dans Android Studio (ou de repousser sur GitHub pour
l'option A) — cette commande recopie le build web à jour dans le projet
natif.

---

C'est un APK **debug** (signé avec la clé de debug par défaut) dans les deux
cas : parfait pour tester sur ton téléphone. Il n'est pas destiné au Play
Store tel quel (il faudrait une signature "release" pour ça).

## Fonctionnalités spécifiques à la version mobile

- **Stockage local** : les données sont sauvegardées sur l'appareil via
  `@capacitor/preferences` (voir `src/storage.js`), aucune connexion
  internet requise pour l'usage courant.
- **Export CSV / Excel** : utilise le panneau de partage natif Android
  (`@capacitor/filesystem` + `@capacitor/share`).
- **Plein écran** : barre de statut/navigation colorées pour matcher le
  thème actif (`@capacitor/status-bar`), zones sûres gérées en CSS
  (encoche, barre de gestes).
- **Bouton retour matériel** : 1er appui → écran d'accueil (ferme d'abord
  les fenêtres ouvertes), 2e appui rapproché (moins de 2 s) → quitte l'app.
- **Thème clair / sombre** : bouton ☀️/🌙 dans l'en-tête, préférence
  sauvegardée sur l'appareil.
- **Synchro Google Drive** : désactivée dans cette version (elle dépendait
  de l'environnement Claude.ai). Le bouton affiche un message clair au lieu
  d'échouer silencieusement — voir `saveToDrive`/`loadFromDrive` dans
  `src/BudgetTracker.jsx` si tu veux la remplacer par une vraie intégration
  plus tard (backend perso, Firebase, WebDAV…).

Voir `FICHE_TECHNIQUE.md` à la racine de ce dossier pour le détail complet
du modèle de données, des règles métier et de l'architecture du projet.
