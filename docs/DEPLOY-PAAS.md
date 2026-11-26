# Déploiement sans carte bancaire (Northflank / Suga)

Alternative à Oracle (qui exige une carte) : l'API tourne dans un conteneur
toujours allumé chez un hébergeur **sans carte bancaire**. Le site routeur
Cloudflare reste le point d'entrée public.

```
Launcher / Admin → https://assetown-api-router-…freebuff.site/api  (Cloudflare)
                 → https://<service>.northflank.app              (HTTPS fourni)
                 → conteneur node:24 → /data (SQLite + builds)
```

> **Constat (novembre 2026)** : Northflank Sandbox annonce « No card needed », mais la
> création du service declenche en pratique une demande de carte bancaire. Le chemin
> **sans carte** est donc **Suga Free** (procédure complète au §4) ; Northflank reste
> documenté au §1 pour plus tard, si une carte devient disponible.
>
> Suga Free : 1 projet, 1 environnement, 0,1 vCPU, **256 Mo de RAM**, **1 Go de stockage**,
> HTTPS/CDN automatique, volume persistant 1 Go max, **aucune carte**, always-on.

L'image est déjà prête : `deploy/Dockerfile` (Node 24, multi-arch, données sur
`/data`, healthcheck sur `/api/health`).

---

## 0. Prérequis : un dépôt Git

Northflank construit l'image depuis un dépôt (GitHub, GitLab…). Depuis la
racine du projet :

```bash
git init
git add .
git commit -m "Assetown — launcher, admin, API, routeur"
git branch -M main
git remote add origin https://github.com/<ton-compte>/assetown.git
git push -u origin main
```

`.env`, `apps/backend/storage/`, `logs/`, `.runtime/` et `release/` sont déjà
exclus par `.gitignore` : **aucun secret ni donnée joueur ne part sur GitHub**.

## 1. Northflank (carte bancaire demandée en pratique)

1. <https://app.northflank.com/signup> — inscription GitHub ou e-mail, **aucune carte**.
2. **Create project** → `assetown`.
3. **Create service → Deployment service → Build from Git** → autorise GitHub →
   choisis le dépôt `assetown`.
4. Build :
   - **Build type** : `Dockerfile`
   - **Build context** : `/` (racine du dépôt)
   - **Dockerfile path** : `deploy/Dockerfile`
5. **Networking** : expose le port **4200** en HTTP (Northflank ajoute le HTTPS).
6. **Health check** : path `/api/health`, port 4200.
7. **Volumes** : ajoute un volume de **5 Go** monté sur `/data`
   (c'est la base SQLite, les builds, les skins et `secret.key`).
8. **Environment variables** (Settings → Environment) :

```ini
NODE_ENV=production
PORT=4200
HOST=0.0.0.0
ASSETOWN_DATA_DIR=/data
PUBLIC_BASE_URL=https://assetown-api-router-3e3dmn-preview.freebuff.site
TRUST_PROXY=true
INITIAL_ADMIN_EMAIL=admin@assetown.fr
INITIAL_ADMIN_PASSWORD=<choisis-un-mot-de-passe-fort>
INITIAL_ADMIN_USERNAME=AssetownAdmin
DEFAULT_SERVER_HOST=play.assetown.fr
DEFAULT_SERVER_PORT=25565
DISCORD_WEBHOOK_URL=<ton-webhook>
WEBHOOK_ENCRYPTION_KEY=<ta-clé>
WEBHOOK_EVENTS=account.created,auth.login,support.report
WEBHOOK_PLAINTEXT=true
```

> ⚠️ Définis `INITIAL_ADMIN_PASSWORD` ici : sur un PaaS tu n'as pas accès au
> fichier `initial-admin.txt`, et c'est le seul moyen simple de récupérer le
> compte propriétaire. Change-le après la première connexion.
>
> Volume non monté = base perdue à chaque redéploiement. Vérifie bien l'étape 7.

9. **Deploy** → attends `Running`, puis ouvre l'URL fournie :

```bash
curl https://<service>.northflank.app/api/health
# {"status":"ok","service":"Assetown",...}
```

## 2. Basculer le routeur

Sites → Secrets → remplace `API_UPSTREAM` par l'URL du service
(`https://<service>.northflank.app`), puis vérifie :

```bash
curl -s https://assetown-api-router-3e3dmn-preview.freebuff.site/router.json | head -6
# "upstream": "<service>.northflank.app", "state": "online"
```

Les `.exe` n'ont rien à changer : ils appellent toujours le site routeur.
Tu peux ensuite fermer `cloudflared` et l'API locale, puis éteindre le PC.

## 3. Données

Le volume démarre vide : c'est volontaire (installation neuve).

- **Comptes** : recréés par les joueurs à l'inscription.
- **Builds** : ré-uploadés depuis le panneau admin (les fichiers passent par
  l'interface, rien à copier à la main).
- **Compte admin** : créé au premier démarrage avec `INITIAL_ADMIN_*`.

Si tu veux malgré tout repartir de la base actuelle, il faut exporter
`assetown.db` + `secret.key` : sans accès SFTP sur le PaaS, le plus simple est
d'ajouter un endpoint d'import temporaire (à demander) ou de passer par un VPS.

## 4. Suga Free — la procédure sans carte (à suivre)

Même dépôt public, même `deploy/Dockerfile`, **aucune carte bancaire**.

1. <https://suga.app> → inscription (GitHub). Aucune carte demandée.
2. **New project** → **Connect GitHub** → installe l'app **Suga** sur ton compte →
   autorise le dépôt **`abyssXeno/AssetownAPI`**.
3. Réglages d'import :
   - **Branch** : `main`
   - **Build method** : **Dockerfile**
   - **Dockerfile path** : `deploy/Dockerfile`
   - **Root directory / build context** : `.` (racine)
4. Sur le canvas, sélectionne le service → onglet **Config** → **Public Networking** →
   **Add** à côté de *Generated URL* → **target port `4200`** → **Apply**.
   L'URL `https://…suga.run` est fournie en HTTPS.
5. **Volume** : ajoute un volume sur le canvas → taille **1 Go** → dépose-le sur le
   service → mount path **`/data`** → **Apply**.
   Le service doit garder **exactement 1 replica** (obligatoire avec un volume).
6. Onglet **Env Vars** : les variables du §1.8 (dont `ASSETOWN_DATA_DIR=/data` et
   `INITIAL_ADMIN_PASSWORD`) → **Save** → **Apply**.
7. **Deploy**, puis vérifie `https://<service>.suga.run/api/health`.

**Limites à connaître** : 1 Go de stockage (donc builds légers), 5 Mbit/s de bande
passante sortante sur le plan gratuit (téléchargements de builds lents), 1 seul
projet par compte.

## 5. Limites à connaître

| Sujet | Réalité |
| --- | --- |
| RAM | 256 Mo (Suga) à ~1 Go (Northflank dans le crédit gratuit) : suffisant pour l'API, pas pour héberger le serveur Minecraft |
| Stockage | 1 Go (Suga) / 5 Go (volume Northflank) : les gros builds doivent rester légers |
| Compilation | l'image compile `packages/shared` + `apps/backend` : ~2 min par déploiement |
| Sauvegardes | télécharge régulièrement le volume si la plateforme le permet ; sinon garde les builds sources en local |
