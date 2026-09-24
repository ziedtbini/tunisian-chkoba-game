# Chkobba Online

Jeu de Chkoba tunisienne en **React + TypeScript + Vite**, avec build natif iOS via **Capacitor**.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Capacitor iOS
- PeerJS (online)
- Firebase Capacitor plugins (app, crashlytics, analytics, remote-config)

## Prerequisites

- Node.js + npm
- macOS + Xcode (pour iOS)
- CocoaPods

## Installation

```bash
npm install
```

## Lancer en web (dev)

```bash
npm run dev
```

## Build web

```bash
npm run build
npm run preview
```

## Validation avant release

```bash
npm run release:check
npm run ios:sync:prod
```

Voir `APP_STORE_RELEASE.md` pour les etapes App Store Connect et TestFlight.

Politique de confidentialite source : `PRIVACY_POLICY.md`.
Page publique GitHub Pages : `docs/privacy-policy.html`.

## iOS (Capacitor)

### 1) Installer les dépendances Capacitor

```bash
npm run ios:install
```

### 2) Ajouter iOS (une seule fois)

```bash
npm run ios:add
```

### 3) Sync web -> iOS

```bash
npm run ios:sync
```

### 4) Ouvrir Xcode

```bash
npm run ios:open
```

Puis dans Xcode:

1. Ouvrir le workspace `ios/App/App.xcworkspace`
2. Configurer `Signing & Capabilities`
3. Vérifier le `Bundle Identifier`
4. Build / Run sur device
5. Archive pour TestFlight/App Store

## Scripts utiles

- `npm run dev` : dev web
- `npm run build` : build production web
- `npm run preview` : preview web
- `npm run ios:sync` : build + sync iOS + pod install
- `npm run ios:open` : ouvrir le projet iOS
- `npm run ios:run` : sync + run iOS

## Online / Multiplayer

- Le transport utilise PeerJS/WebRTC et le signalling public PeerJS (`src/onlineManager.ts`).
- Le host conserve l'etat complet et reste la seule autorite sur les actions et les manches.
- Les actions distantes sont validees cote host (tour, carte possedee et capture exacte).
- Les snapshots 1v1 envoyes au guest excluent la main du host et le deck.
- Les snapshots 2v2 envoyes a l'equipe B excluent les mains p1/p3 et le deck.
- Le protocole v2 est actif en 1v1 et 2v2; aucun état gameplay legacy n'est accepté.
- La room est verrouillée après admission de la session, surveillée par heartbeat et récupérable pendant 60 secondes avec `matchId` + token.
- Le retour foreground Capacitor declenche une verification de signalling et une resynchronisation.
- Le protocole v2, ses validateurs et les projections filtrées sont dans `src/online/`.

### TURN optionnel et limites P2P

Les serveurs STUN Google sont utilises par defaut. Certaines configurations NAT strictes peuvent necessiter TURN.
Un TURN peut etre fourni sans mettre de secret dans le code avec :

```env
VITE_TURN_URL=turns:example.invalid:5349
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

Sans backend, une partie ne peut pas etre restauree si le processus du telephone host est completement tue : son etat autoritaire n'existe plus. Une interruption reseau ou un passage temporaire en arriere-plan est en revanche retente pendant la fenetre de reconnexion.

Plan de validation sur appareils reels : `docs/ONLINE_TEST_PLAN.md`.

## Firebase

Le projet intègre des plugins Firebase côté Capacitor.

Fichier principal d’intégration:
- `src/firebase.ts`

Init au démarrage:
- `src/main.tsx`

## Contrôle de version app (Remote Config)

Le projet supporte popup de mise à jour optionnelle/obligatoire via Firebase Remote Config.

Clés utilisées:
- `update_latest_version`
- `update_min_supported_version`
- `update_force_update`
- `update_title`
- `update_message`
- `update_ios_store_url`
- `update_android_store_url`

Logique:
- Si `current < min_supported` et `force_update=true` => popup bloquante
- Sinon si `current < latest` => popup optionnelle

Détails iOS et déploiement:
- voir `IOS_DEPLOY.md`

## Structure principale

- `src/ChkobaGame.tsx` : gameplay 1v1 / écran principal
- `src/Chkoba2v2.tsx` : gameplay 2v2
- `src/gameLogic.ts` : logique de jeu
- `src/onlineManager.ts` : couche online
- `src/CardComponent.tsx` : affichage cartes
- `src/index.css` : thème/style global

## Notes sécurité

Les fichiers sensibles ne doivent pas être commités:
- `GoogleService-Info.plist`
- `AuthKey_*.p8`
- certificats / profils iOS

Un `.gitignore` est déjà fourni à la racine.
