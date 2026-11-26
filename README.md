# ASSETOWN — écosystème launcher

Écosystème complet pour le serveur Minecraft **Assetown** :

| Composant | Dossier | Rôle |
| --- | --- | --- |
| **Assetown Launcher** | `apps/launcher` | Application Windows (Electron) pour les joueurs : comptes, V1/V2/V3, installation et mises à jour automatiques, skins, lancement du jeu |
| **ASSETOWN ADMIN PANEL** | `apps/admin` | Application Windows séparée, réservée à l'équipe : builds, annonces, joueurs, rapports, audit |
| **API Assetown** | `apps/backend` | Serveur HTTP + SQLite : comptes, sessions, manifests, téléchargements signés, annonces, administration |
| **Routeur API (site)** | `site` | Site public : page d'état + proxy `/api/*` vers l'API, point d'entrée unique pour les deux applications |
| **Contrats partagés** | `packages/shared` | Types TypeScript communs (manifest, profils, permissions) |

---

## 1. Ce qui fonctionne réellement

- **Vraie installation Minecraft** : version JSON Mojang, client `.jar`, bibliothèques (règles OS), ressources (`assets`), extraction des natives, profil **Fabric** officiel, profils **Forge/NeoForge** via JSON fourni par l'admin.
- **Lancement du jeu** hors ligne (pseudo = identité de jeu, UUID hors-ligne identique à Minecraft), avec RAM, résolution, plein écran, arguments JVM/jeu, connexion automatique au serveur de la version.
- **Synchronisation par manifest + SHA-256** : détection des fichiers obsolètes, téléchargement reprenable (pause/reprise), vérification d'intégrité, suppression des fichiers gérés uniquement, sauvegarde des configurations avant mise à jour, protection stricte de `saves/`, `screenshots/`, `options.txt`, `logs/`, `skins/`…
- **Comptes** : inscription (e-mail + pseudo Minecraft + mot de passe + Discord), connexion, déconnexion, mot de passe oublié, vérification d'e-mail, unicité du pseudo, session chiffrée par le coffre Windows (DPAPI), reconnexion automatique, modification des informations, suppression de compte.
- **Skins** : import PNG 64×64 validé serveur, aperçu **3D** (three.js), modèles Steve/Alex, restauration du skin précédent, endpoint public `/api/skins/<pseudo>.png`.
- **Panneau admin** : connexion séparée par rôle, tableau de bord, builds (upload, test, publication, archivage, retour arrière), annonces (image, épinglage, programmation), gestion des joueurs, rapports de support, journal d'audit, personnalisation (logo, bannière, Discord, maintenance).
- **Sécurité** : scrypt pour les mots de passe, jetons HMAC + rotation des refresh tokens, permissions serveur, HTTPS imposé hors localhost, téléchargements signés HMAC avec expiration, audit de toutes les actions sensibles.
- **Webhooks Discord chiffrés** : inscriptions, connexions (IP, user-agent) et tickets de support envoyés à un webhook, charges sensibles chiffrées en AES-256-GCM (pièce jointe `.enc`, URL et clé uniquement côté serveur). Voir `docs/INSTALLATION.md` §4.

### Limites assumées (assumées et documentées)

- **Authentification Microsoft non implémentée** : l'architecture est prête (un fournisseur d'auth par type de compte peut être branché), mais seul le mode hors ligne est actif aujourd'hui.
- **Forge / NeoForge** : le launcher ne lance pas l'installateur officiel ; l'administrateur fournit le **profil de version JSON** généré par l'installateur (hébergé en HTTPS), que le launcher fusionne et télécharge.
- **Java n'est pas installé automatiquement** : le launcher détecte Java 8/17/21+ sur le poste, indique la version requise par le build et permet de choisir l'exécutable dans les paramètres.
- **macOS / Linux** : la configuration `electron-builder` existe, mais seules les cibles Windows ont été préparées et vérifiées ici.
- **Rich Presence Discord** : emplacement prévu (lien Discord, événements), intégration RPC à ajouter ultérieurement.
- **Signature de code absente** : les installeurs NSIS sont produits localement (`apps/*/release/`, ignoré par git) mais ne sont pas signés — Windows SmartScreen affichera un avertissement au premier lancement.

---

## 2. Prérequis

- **Node.js ≥ 22.5** (le backend utilise `node:sqlite`, intégré à Node : aucune base de données à installer).
- **Java 17 ou 21** sur le poste joueur (Temurin recommandé) pour Minecraft 1.17+.
- Windows 10/11 pour les launchers (Electron 33).
- En production : un domaine **HTTPS** pour l'API (nginx, Caddy, Cloudflare Tunnel…).

## 3. Démarrage rapide (développement)

```bash
npm install                 # installe les 3 applications + dépendances

# 1) API
npm run build:backend
npm start -w @assetown/backend
# → http://127.0.0.1:4200
# → identifiants admin générés dans apps/backend/storage/initial-admin.txt

# 2) Données de démonstration (optionnel, publie un build V2 de test)
npm run seed -w @assetown/backend -- --publish

# 3) Launcher joueur (Vite + Electron)
npm run dev -w @assetown/launcher

# 4) Panneau d'administration (séparé, port 5184)
npm run dev -w @assetown/admin
```

Comptes de test créés par vous via l'inscription du launcher. L'e-mail de vérification est écrit dans `apps/backend/storage/mail-outbox/` tant que SMTP n'est pas configuré (le launcher affiche aussi le lien en développement).

## 4. Compilation des applications Windows

```bash
npm run build                    # shared + backend + launcher + admin (renderers + main)
npm run package:win -w @assetown/launcher   # → apps/launcher/release/Assetown-Setup-1.0.0.exe
npm run package:win -w @assetown/admin      # → apps/admin/release/Assetown-Admin-Setup-1.0.0.exe
```

Les installeurs NSIS permettent de choisir le dossier d'installation et créent les raccourcis. Les icônes `apps/*/build/icon.png` (512×512) sont générées depuis le logo SVG officiel : `npx electron scripts/make-icon.mjs`.

Artefacts produits :

| Livrable | Fichier | Contenu |
| --- | --- | --- |
| Launcher joueur | `apps/launcher/release/Assetown-Setup-1.0.0.exe` | Electron 33 x64, renderer + main/preload, icône Assetown |
| Panneau d'administration | `apps/admin/release/Assetown-Admin-Setup-1.0.0.exe` | Electron 33 x64, console d'administration séparée |
| Routeur API | `site/` → `https://assetown-api-router-3e3dmn-preview.freebuff.site` | Worker Cloudflare : page d'état + proxy `/api/*` |

### Site routeur (API)

`site/` est un Worker autonome déployé sur Freebuff Sites (`site/deploy.json`). Il expose :

- `GET /` — page d'état (backend joignable, latence, base URL, routes) ;
- `GET /router.json` — description machine des routes et de la cible ;
- `/api/*` — proxy transparent vers le backend : méthode, `Authorization`, `Range`, corps binaires et flux de réponse sont conservés (builds, skins, uploads).

Identifiant du site (Freebuff Sites) : `7c1f4b2a-9d3e-4a6b-8f21-5c0d9e7b3a61` — manifeste `site/deploy.json`.

Le backend cible est lu dans la variable `API_UPSTREAM` du Worker (ex. `http://51.83.x.x:4200` ou `https://api.assetown.fr`). Sans cette variable, la page affiche « BACKEND NON CONFIGURÉ » et `/api/*` répond `503 router_misconfigured` : aucun backend factice n'est utilisé. Deux façons de la définir :

1. **Sites → Secrets** : créer la variable `API_UPSTREAM` avec l'URL du serveur (aucun redéploiement nécessaire) ;
2. modifier la constante `DEFAULT_UPSTREAM` dans `site/src/index.js`, puis redéployer `site/deploy.json`.

Le launcher et le panneau admin visent par défaut `https://assetown-api-router-3e3dmn-preview.freebuff.site` (constante `apiBaseUrl` dans `apps/*/src/main/store.ts`) : l'URL reste modifiable à la connexion si besoin.

### Backend sur un PC + tunnel Cloudflare (configuration actuelle)

Le backend écoute en `127.0.0.1:4200` (aucun port ouvert sur la box) et un tunnel sortant le rend joignable par le routeur :

```bash
# terminal 1 — API
npm start -w @assetown/backend

# terminal 2 — tunnel (cloudflared installé globalement)
cloudflared tunnel --url http://127.0.0.1:4200 --no-autoupdate
# → https://<nom-aleatoire>.trycloudflare.com
```

`.env` correspondant :

```ini
HOST=127.0.0.1
PUBLIC_BASE_URL=https://assetown-api-router-3e3dmn-preview.freebuff.site
TRUST_PROXY=true
```

> **Attention** : un tunnel rapide (`trycloudflare.com`) change d'URL à chaque redémarrage. Il faut alors recréer la variable `API_UPSTREAM` du site avec la nouvelle URL (`sites_set_secret` ou Sites → Secrets) — le routeur et les launchers, eux, ne changent pas. Pour une URL stable, utilisez un tunnel nommé Cloudflare avec votre domaine, ou un VPS.

Vérification locale du routeur : `node scripts/test-router.mjs http://127.0.0.1:4200` (15 contrôles : page, proxy GET/POST, 404, 502 backend injoignable, 503 non configuré).

## 5. Structure

```
ASSETOWN LAUNCHER/
├─ apps/
│  ├─ backend/          API HTTP, SQLite, storage/ (builds, skins, rapports, journaux)
│  ├─ launcher/         Electron + React + TypeScript (joueurs)
│  │  └─ src/main/      minecraft.ts, sync.ts, game.ts, api.ts, ipc.ts…
│  └─ admin/            Electron + React + TypeScript (équipe)
├─ packages/shared/     types et constantes partagés
├─ scripts/smoke-test.mjs  test de bout en bout de l'API
├─ docs/
│  ├─ INSTALLATION.md   installation serveur + postes joueurs
│  ├─ ADMIN.md          guide du panneau d'administration
│  ├─ BUILDS.md         format des builds, manifest, synchronisation
│  └─ API.md            référence des endpoints
└─ .env.example         configuration du backend
```

## 6. Vérifications effectuées

- `tsc` sans erreur : `packages/shared`, `apps/backend`, `apps/launcher` (main + renderer), `apps/admin` (main + renderer).
- `vite build` + bundling Electron : launcher (679 kB JS / 21 kB CSS) et admin (206 kB JS / 14 kB CSS).
- **42 contrôles d'API** (`node scripts/smoke-test.mjs`) : inscription, doublon de pseudo, mot de passe faible, connexion, 401, refresh, skin (PNG valide/invalide), admin (403 pour un joueur), création/upload/test/publication d'un build, manifest, hash, signature falsifiée → 403, ETag 304, annonces, notifications, désactivation de version, désactivation de compte, audit, permissions, rapports, mot de passe oublié.
- Démarrage réel des applications Electron : le process principal du launcher boote, charge son renderer et écrit `%APPDATA%/Assetown/logs/launcher.log`.
- Parcours d'interface vérifiés dans un navigateur (même code renderer) : inscription/connexion joueur → accueil complet (V1/V2/V3, actualités, état des serveurs), connexion administrateur → tableau de bord (compteurs, graphique, joueurs, builds, audit) → page Builds & versions.
- **Installeurs NSIS produits** : `Assetown-Setup-1.0.0.exe` (84,5 Mo) et `Assetown-Admin-Setup-1.0.0.exe` (82,4 Mo), electron-builder 25.1.8 / Electron 33.4.11 ; les deux exécutables empaquetés (`release/win-unpacked`) ont été lancés et restent actifs après 9 s (fenêtre Chromium initialisée), le launcher écrivant `%APPDATA%/Assetown/logs/launcher.log`.
- **Routeur** : 15 contrôles locaux (`node scripts/test-router.mjs`) + vérification du déploiement réel (page 200, `router.json`, favicon, `/api/health` → 503 tant que `API_UPSTREAM` n'est pas défini).
- Non vérifié ici : lancement réel d'une partie Minecraft (téléchargement Mojang de ~250 Mo + Java non installés sur la machine de build), synchronisation dans l'application Electron en conditions réelles (l'algorithme, le manifest et la vérification de hash sont testés côté API), proxy du routeur vers un backend public (aucun serveur public disponible pour l'instant).

## 7. Documentation

- [Installation & exploitation](docs/INSTALLATION.md)
- [Guide administrateur](docs/ADMIN.md)
- [Builds, manifests et synchronisation](docs/BUILDS.md)
- [Référence API](docs/API.md)
- [Déploiement sur Oracle Cloud (Always Free) + DuckDNS](docs/DEPLOY-ORACLE.md) — API toujours allumée, PC éteint (carte bancaire requise à l'inscription)
- [Déploiement sans carte bancaire (Northflank / Suga)](docs/DEPLOY-PAAS.md) — conteneur always-on, HTTPS et volume persistant
