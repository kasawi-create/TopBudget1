# BudgetBacker — Fiche technique

Application mobile de suivi budgétaire personnel (comptes, transactions, budgets,
statistiques), packagée en APK Android via Capacitor. Ce document décrit
l'ensemble des caractéristiques du projet pour permettre de le reproduire
avec un autre outil.

## 1. Stack technique

- **Framework** : React 19 (fonctionnel, hooks uniquement, pas de classes).
- **Bundler** : Vite.
- **Graphiques** : `recharts` (PieChart pour la répartition par catégorie,
  BarChart pour Revenus vs Dépenses).
- **Icônes** : `lucide-react`.
- **Export tableur** : `xlsx` (SheetJS).
- **Packaging mobile** : Capacitor 8 (Android). Plugins utilisés :
  `@capacitor/preferences` (stockage), `@capacitor/filesystem` +
  `@capacitor/share` (export de fichiers), `@capacitor/status-bar` (barre de
  statut plein écran).
- **Un seul fichier composant principal** : toute la logique et tous les
  sous-composants vivent dans `BudgetTracker.jsx` (~1800 lignes) — pas de
  routing, pas de state management externe (tout est en `useState`/`useMemo`
  au niveau du composant racine, redescendu par props).
- **Style** : CSS-in-JS via l'attribut `style={{...}}` inline sur chaque
  élément (aucune feuille de style externe, aucun framework CSS). Police
  "Space Grotesk" importée depuis Google Fonts via une balise `<style>` avec
  `@import`.

## 2. Palette de couleurs (design tokens)

Objet `COLORS` **mutable** (pas une constante figée) avec deux jeux de
valeurs, permutés par une fonction `applyTheme(theme)` appelée en tout début
de rendu du composant racine :

| Token      | Sombre (`dark`) | Clair (`light`) |
|------------|------------------|------------------|
| `bg`       | `#12202B`        | `#F5F1E9`        |
| `surface`  | `#1B2C39`        | `#FFFFFF`        |
| `surface2` | `#233A49`        | `#EDE6D8`        |
| `border`   | `#2E4757`        | `#DDD3C0`        |
| `text`     | `#EDEAE2`        | `#20303A`        |
| `textDim`  | `#93A6B3`        | `#6C7A82`        |
| `gold`     | `#C9974C`        | `#AD7A34`        |
| `mint`     | `#4FD8A0`        | `#2FA574`        |
| `coral`    | `#E8674B`        | `#D14E30`        |
| `sky`      | `#5FA8D3`        | `#2F7FB0`        |
| `purple`   | `#B589D6`        | `#8E5CB8`        |

Palette de couleurs de catégories (`PALETTE`, indépendante du thème) :
`#4FD8A0, #5FA8D3, #C9974C, #B589D6, #E8674B, #E0B84B, #7C93A3, #93A6B3`.

**Pourquoi un objet mutable plutôt qu'un Context React** : la bascule de
thème ne passe pas par un Context/props à cause de la taille du fichier
(dizaines de composants lisent `COLORS.xxx` directement). `applyTheme()`
fait un `Object.assign(COLORS, palette)` avant chaque rendu ; les deux seuls
composants mémoïsés (`React.memo`) reçoivent une prop `theme` supplémentaire
uniquement pour invalider leur cache au changement de thème.

## 3. Modèle de données

Toutes les données sont dans le state React du composant racine, persistées
en JSON sous une seule clé de stockage `"budgetbacker:data"`.

```ts
Account = {
  id: string
  name: string
  type: "Banque" | "Espèces" | "Carte"
  initialBalance: number          // seule valeur éditable manuellement
  color?: string                  // couleur de fond du cadran (point 7)
}
// balance affiché = initialBalance + somme(transactions.amount pour ce compte)
// -> TOUJOURS dérivé, jamais stocké directement.

Transaction = {
  id: string
  type: "expense" | "income"
  amount: number                  // négatif si dépense, positif si revenu
  label: string
  categoryId: string              // catégorie ou sous-catégorie
  accountId: string
  date: string                    // "YYYY-MM-DD"
  isTransfer?: boolean            // true pour les 2 lignes d'un virement compte->compte
  transferGroup?: string          // id commun aux 2 lignes d'un même virement
}

Budget = {
  id: string
  categoryId: string              // catégorie de premier niveau uniquement
  limit: number                   // plafond mensuel de base
}

Category = {
  id: string
  name: string
  icon: string                    // emoji
  color: string
  parentId: string | null         // null = catégorie top-level, sinon sous-catégorie
  nature: "expense" | "income"    // uniquement pertinent pour les catégories top-level
  isTransferCategory?: true       // uniquement sur la catégorie "Virement" (structurelle)
}

CategoryTransfer = {
  id: string
  date: string
  fromCategoryId: string
  toCategoryId: string
  amount: number                  // toujours positif
  note?: string
}
```

Catégories par défaut créées à l'installation (`buildDefaultCategories()`) :
Alimentation (+ Courses, Restaurants), Transport (+ Carburant, Transport
public), Logement (+ Loyer, Charges), Loisirs (+ Sorties, Abonnements),
Santé, Shopping, Factures, Revenu (`nature: "income"`), Virement
(`isTransferCategory: true`), Autre.

Comptes par défaut : un compte "Banque" et un compte "Espèces".

## 4. Règles métier clés

- **Solde d'un compte** = `initialBalance + Σ(transactions.amount)`. Toujours
  recalculé, jamais stocké — élimine toute possibilité de désynchronisation.
  Le solde initial ne se modifie que depuis l'écran de détail du compte
  (jamais depuis la liste principale, pour éviter les saisies accidentelles).
- **Virement entre comptes** : crée 2 transactions liées par `transferGroup`
  (une sortie négative sur le compte source, une entrée positive sur le
  compte destination), toutes deux `isTransfer: true`, catégorisées sur la
  catégorie structurelle `isTransferCategory`. Exclues des totaux
  revenus/dépenses et de la répartition par catégorie.
- **Transfert entre catégories** (réallocation budgétaire) : n'affecte
  *aucune* transaction ni aucun compte. Modifie uniquement le plafond
  *effectif* d'un budget pour la période affichée :
  `effectiveLimit = budget.limit + Σ(transferts où toCategoryId = cat) - Σ(transferts où fromCategoryId = cat)`,
  calculé sur la période actuellement affichée (mois ou année).
- **Historique des transferts** : deux listes distinctes et non mélangées —
  virements entre comptes (reconstruits à partir des `transferGroup` dans
  `transactions`) et transferts entre catégories (`categoryTransfers`).
- **Sélection de catégorie sur une transaction** : indépendante du type
  choisi (dépense/revenu) — la liste déroulante affiche toutes les
  catégories, groupées "Dépenses" puis "Revenus" via `<optgroup>`. Seule la
  catégorie `isTransferCategory` est exclue (réservée aux virements).
- **Édition d'une catégorie existante** : nom, icône, couleur et nature sont
  modifiables via un formulaire inline (icône crayon). Le rattachement de la
  catégorie "Virement" à la logique de virement se fait via le flag
  structurel `isTransferCategory`, jamais par comparaison de nom — renommer
  une catégorie est donc toujours sûr.

## 5. Écrans / composants principaux

- **Header** : cadrans de comptes défilables horizontalement (sélection par
  tap = filtre, appui long = sélection multiple), bouton bascule thème,
  avatar.
- **Accueil (`HomeTab`)** : donut des dépenses par catégorie (total au
  centre), légende avec % , liste des transactions récentes.
- **Historique (`TransactionsTab`)** : liste complète des transactions de la
  période, icône teintée par couleur de catégorie.
- **Budgets (`BudgetsTab`)** : barres de progression par catégorie
  (dégradé, alerte si dépassement), bouton "Transférer" (ouvre
  `CategoryTransferModal`), liste des catégories sans budget encore défini.
- **Stats (`StatsTab`)** : graphique en barres Revenus/Dépenses (6 ou 12
  mois selon le mode période), répartition par catégorie avec drill-down
  vers les sous-catégories.
- **Comptes (`AccountsTab`)** : sauvegarde cloud (Google Drive — voir
  limitations ci-dessous), export CSV/Excel, gestionnaire de catégories
  (`CategoryManager`, avec édition inline), liste des comptes (solde actuel
  seul, lecture seule — tap ouvre `AccountDetailModal`), bouton
  "Historique" (ouvre `TransfersHistoryModal`).
- **Modales** : `AddTransactionModal` (dépense/revenu/virement),
  `AddAccountModal`, `AccountDetailModal` (solde initial éditable),
  `CategoryTransferModal`, `TransfersHistoryModal`.

## 6. Comportements spécifiques mobile (Capacitor)

- **Stockage** : `window.storage` (API propre à l'environnement artefact
  Claude.ai) remplacée par un petit shim `src/storage.js` basé sur
  `@capacitor/preferences` (persistant nativement sur Android, retombe sur
  `localStorage` dans un navigateur classique).
- **Export CSV/Excel** : au lieu d'un téléchargement navigateur (qui ne
  fonctionne pas dans une WebView Android), écriture du fichier via
  `@capacitor/filesystem` (répertoire cache) puis ouverture du panneau de
  partage natif via `@capacitor/share`.
- **Synchro Google Drive** : désactivée dans la version mobile. La version
  web/artefact appelait l'API Anthropic avec un serveur MCP Google Drive —
  cela nécessite une clé API injectée côté serveur, impossible à exposer
  sûrement depuis une app cliente. Le bouton affiche un message explicite au
  lieu d'échouer silencieusement.
- **Bouton retour matériel Android** : intercepté via l'API navigateur
  standard `window.history.pushState` / évènement `popstate` (pas besoin du
  plugin `@capacitor/app`) : chaque navigation (changement d'onglet,
  ouverture de modale) pousse une entrée d'historique factice ; un retour
  ferme d'abord les modales ouvertes, puis ramène à l'onglet Accueil, puis
  nécessite un second appui rapproché (< 2 s) pour quitter l'app (toast
  d'avertissement affiché au 1er appui).
- **Plein écran** : conteneur racine en `height: 100dvh` (plus de carte à
  largeur fixe façon aperçu desktop), paddings `env(safe-area-inset-*)` pour
  les encoches/barres système, et configuration native (`@capacitor/status-bar`,
  couleurs de la barre de statut/navigation dans les ressources Android)
  pour que l'app couvre réellement tout l'écran.

## 7. Personnalisation visuelle des comptes (cadrans)

- Cadran en relief "3D" : dégradé de fond (couleur du compte → variante plus
  sombre), légère ombre portée, liseré clair en haut (highlight) pour
  simuler un bevel — pas de vraie géométrie 3D, effet purement CSS.
- Effet de pression au toucher : le cadran s'enfonce légèrement (translation
  + réduction d'ombre) pendant l'appui, sans suivi du doigt (pas de tilt en
  temps réel — jugé trop instable en combinaison avec le scroll horizontal
  et l'appui long déjà utilisés sur ces cadrans).
- Couleur de fond choisie par l'utilisateur, par compte, stockée dans
  `account.color`, éditable depuis `AccountDetailModal`.

## 8. Ce qu'il faudrait recoder si repris avec un autre outil

- Toute la logique métier (formules de solde, agrégations par catégorie,
  gestion des virements/transferts) est dans un seul composant — à séparer
  en hooks/services si l'outil cible préfère une architecture modulaire.
- Le système de thème "objet mutable + re-render forcé" est une solution
  pragmatique adaptée à un fichier unique ; avec un projet multi-fichiers,
  un `React.Context` classique serait plus propre.
- Aucun backend : tout est local (stockage device). Une vraie synchro cloud
  nécessiterait un backend dédié (ou Firebase/Supabase) plutôt que l'appel
  direct à l'API Anthropic utilisé dans la version artefact.
