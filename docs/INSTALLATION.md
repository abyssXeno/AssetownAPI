# INSTALLATION & EXPLOITATION

## 1. Serveur (API Assetown)

### 1.1 Préparation

```bash
npm install
cp .env.example .env
# éditez .env (voir ci-dessous)
npm run build:backend
npm start -w @assetown/backend
```

Le serveur écoute par défaut sur `127.0.0.1:4200`. Il crée automatiquement :

```
apps/backend/storage/
├─ assetown.db            base SQLite (WAL)
├─ secret.key             secret HMAC des sessions/téléchargements (0600)
├─ initial-admin.txt      identifiants du compte propriétaire initial
├─ builds/<buildId>/      fichiers des builds (mods, configs…)
├─ skins/                 skins PNG des joueurs
├─ reports/               journaux joints aux rapports de support
├─ uploads/               images des annonces / bannières
├─ mail-outbox/           e-mails non envoyés (si SMTP absent)
└─ logs/server.log
```

> **Sauvegardez** `assetown.db`, `secret.key` et le dossier `builds/`. Sans `secret.key`, tous les jetons et liens de téléchargement deviennent invalides (les joueurs devront se reconnecter).

### 1.2 Variables d'environnement (`.env`)

| Variable | Description |
| --- | --- |
| `PORT`, `HOST` | Écoute de l'API (défaut `4200` / `127.0.0.1`) |
| `PUBLIC_BASE_URL` | **URL publique HTTPS** utilisée dans les manifests et les liens. Obligatoire en production. |
| `ASSETOWN_SECRET` | Secret HMAC (sinon généré dans `secret.key`) |
| `ASSETOWN_DATA_DIR` | Dossier de stockage alternatif |
| `DEFAULT_SERVER_HOST` / `DEFAULT_SERVER_PORT` | Serveur Minecraft utilisé à la création des versions |
| `DISCORD_WEBHOOK_URL` | Webhook Discord des événements sensibles (inscriptions, connexions, support). Vide = désactivé |
| `WEBHOOK_ENCRYPTION_KEY` | Clé AES-256-GCM des charges webhook (vide = dérivée de `ASSETOWN_SECRET`) |
| `WEBHOOK_EVENTS` | Événements envoyés (défaut `account.created,auth.login,support.report`) |
| `WEBHOOK_PLAINTEXT` | `true` pour afficher le pseudo en clair dans Discord (tout le reste reste chiffré) |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_USERNAME` | Compte propriétaire créé si aucun admin n'existe. Mot de passe vide → généré. |
| `SMTP_*` | Envoi réel des e-mails (vérification, mot de passe oublié). Sans SMTP, les e-mails sont écrits dans `mail-outbox/`. |
| `TRUST_PROXY` | `true` derrière nginx/Caddy (lit `X-Forwarded-For`) |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | Durées de vie en secondes |

**Ne commitez jamais `.env`.** Les launchers ne contiennent aucun secret : ils ne parlent qu'à l'API.

### 1.3 Mise en production HTTPS

Exemple nginx :

```nginx
server {
  listen 443 ssl http2;
  server_name api.assetown.fr;
  ssl_certificate     /etc/letsencrypt/live/api.assetown.fr/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.assetown.fr/privkey.pem;

  client_max_body_size 300m;      # upload de mods depuis le panneau admin
  proxy_read_timeout 300s;

  location / {
    proxy_pass         http://127.0.0.1:4200;
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $remote_addr;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

Puis dans `.env` :

```ini
PUBLIC_BASE_URL=https://api.assetown.fr
TRUST_PROXY=true
```

Les launchers refusent toute API en `http://` hors `127.0.0.1`/`localhost` : c'est volontaire (protection des mots de passe et des téléchargements).

### 1.4 Première connexion administrateur

`apps/backend/storage/initial-admin.txt` contient l'e-mail et le mot de passe du compte propriétaire. Connectez-vous avec dans **ASSETOWN ADMIN PANEL**, puis changez immédiatement le mot de passe depuis le launcher joueur (Paramètres → Compte) ou en base.

Le compte propriétaire peut ensuite :
- nommer des `admin`, `moderator` ;
- attribuer des permissions fines (voir `docs/ADMIN.md`) ;
- supprimer des comptes.

### 1.5 Données de démonstration

```bash
npm run seed -w @assetown/backend            # annonces + build V2 brouillon testé
npm run seed -w @assetown/backend -- --publish  # publie ce build V2 (fichiers de config factices)
```

Supprimez/remplacez ce build de démonstration depuis le panneau admin avant l'ouverture au public.

### 1.6 Service persistant (Windows)

```powershell
# avec NSSM (https://nssm.cc)
nssm install AssetownAPI "C:\Program Files\nodejs\node.exe" "C:\assetown\apps\backend\dist\index.js"
nssm set AssetownAPI AppDirectory "C:\assetown\apps\backend"
nssm set AssetownAPI AppEnvironmentExtra NODE_ENV=production
nssm start AssetownAPI
```

Sous Linux : unité `systemd` avec `WorkingDirectory=/opt/assetown/apps/backend` et `ExecStart=/usr/bin/node dist/index.js`, `Restart=always`.

---

## 2. Poste joueur

1. Installez **Java 17 ou 21** (Eclipse Temurin) — le launcher détecte `JAVA_HOME`, les installations standard et permet de choisir `javaw.exe`.
2. Installez `Assetown-Setup-1.0.0.exe`.
3. Premier lancement :
   - **Créer un compte** (e-mail, pseudo Minecraft, mot de passe, Discord) ou se connecter ;
   - choisir **V1 / V2 / V3** ;
   - cliquer **JOUER** : le launcher télécharge le build (progression, vitesse, pause/reprise) puis installe Minecraft et lance le jeu.
4. Lancements suivants : reconnexion automatique, vérification du manifest, seuls les fichiers modifiés sont retéléchargés, puis actualités et bouton JOUER.

Réglages utiles (Paramètres) : RAM, résolution, plein écran, langue FR/EN, démarrage automatique, dossier d'installation, chemin Java, arguments JVM, réparation des fichiers, vidage du cache, réinitialisation.

Emplacement des données joueur :

```
%APPDATA%/Assetown/           settings.json, session chiffrée (DPAPI), journaux
<dossier d'installation>/     _shared/ (Minecraft vanilla partagé)
                              v1/ v2/ v3/  (mods, config, saves, screenshots, logs, backups)
```

Les mises à jour ne touchent **jamais** `saves/`, `screenshots/`, `options.txt`, `logs/`, `skins/`, `servers.dat`, `resourcepacks/`, `shaderpacks/` ni `backups/`.

---

## 3. Panneau d'administration

Lancez `Assetown-Admin-Setup-1.0.0.exe`, renseignez l'URL de l'API (bouton « Configurer le serveur ») puis connectez-vous avec un compte de rôle `moderator`, `admin` ou `owner`. Les comptes joueurs sont refusés côté serveur.

---

## 4. Webhooks Discord chiffrés

Le serveur peut notifier un salon Discord à chaque **inscription**, **connexion** (pseudo, rôle, IP, user-agent) et **ticket de support** (sujet, message, système, IP).

1. Dans Discord : *Paramètres du salon → Intégrations → Webhooks → Nouveau webhook*, copiez l'URL.
2. Dans `.env` :

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…
WEBHOOK_ENCRYPTION_KEY=une-phrase-secrete-longue-et-unique
WEBHOOK_EVENTS=account.created,auth.login,support.report
```

3. Redémarrez l'API.

**Ce qui circule :** l'embed Discord ne contient que le titre de l'événement et, si `WEBHOOK_PLAINTEXT=true`, le pseudo. L'e-mail, l'IP, l'user-agent et le contenu du ticket sont chiffrés en **AES-256-GCM** (nonce aléatoire, tag d'authentification) et envoyés en pièce jointe `.enc.txt`. Sans la clé, le fichier est inutilisable.

Lecture d'un fichier reçu :

```bash
node scripts/decrypt-webhook.mjs telechargements/assetown-auth.login-2026-11-26T18-00-00-000Z.enc.txt
```

Test local sans publier dans Discord :

```bash
# terminal 1
node scripts/webhook-inspect.mjs 4999 "la-meme-cle"
# terminal 2 (API avec un webhook local)
DISCORD_WEBHOOK_URL=http://127.0.0.1:4999/hook WEBHOOK_ENCRYPTION_KEY="la-meme-cle" npm start -w @assetown/backend
```

> Si le webhook est indisponible, l'API ne bloque pas : 3 tentatives avec temporisation, puis un avertissement dans `storage/logs/server.log`. L'URL et la clé ne sont **jamais** transmises aux launchers ni écrites dans les journaux (l'URL est masquée).

## 5. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| « Serveur Assetown injoignable » | API arrêtée, mauvaise URL, ou HTTP non localhost. Vérifiez `PUBLIC_BASE_URL`, le port 4200 et le pare-feu. |
| `Java introuvable` | Installez Java 17/21 ; indiquez le chemin dans Paramètres → Java. |
| « Ce build requiert Java X » | Mettez à jour Java (le build déclare la version Mojang requise). |
| Un fichier échoue en boucle | Lancez **Paramètres → Réparer les fichiers**. Le fichier est re-téléchargé et son SHA-256 revérifié. |
| 403 `invalid_signature` dans les journaux serveur | Lien de téléchargement expiré (12 h) ou `ASSETOWN_SECRET` modifié. Relancez la synchronisation. |
| E-mail non reçu | Sans SMTP, l'e-mail est dans `storage/mail-outbox/`. Configurez `SMTP_*`. |
| `Warning: SQLite is an experimental feature` | Normal avec Node 22/23 ; passez à Node 24 pour le supprimer. |
| Le panneau admin refuse la connexion | Le compte doit avoir un rôle ≠ `player` ; vérifiez dans la base ou via un autre admin. |
| Port 4200 occupé | `PORT=4300` dans `.env` + `PUBLIC_BASE_URL` correspondant, puis mettez à jour l'URL dans les deux launchers. |

Journaux : `apps/backend/storage/logs/server.log` (serveur), `%APPDATA%/Assetown/logs/launcher.log` (joueur), export ZIP depuis Support → « Exporter les logs ».
