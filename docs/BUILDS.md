# BUILDS, MANIFESTS ET SYNCHRONISATION

## 1. Modèle de données

```
channels (v1, v2, v3)      → nom, description, accent, host/port Minecraft, enabled, active_build_id
builds                     → canal, version MC, loader + version, RAM, arguments, statut, publication
build_files                → chemin relatif, taille, sha256, kind, storage_path
```

Statuts d'un build : `draft` → `tested` → `published` → `archived` (réactivables). Un seul build `published` par canal.

## 2. Arborescence de stockage

```
apps/backend/storage/builds/<buildId>/
├─ mods/<mod>.jar
├─ config/<...>
├─ resourcepacks/<...>
└─ shaderpacks/<...>
```

Le chemin stocké dans `build_files.path` est aussi le chemin d'installation côté joueur. Les chemins sont normalisés et validés (`safeRelativePath`) : pas de `..`, pas de chemin absolu, 12 niveaux maximum.

## 3. Manifest

`GET /api/builds/:channel/manifest` (ETag, 304 supporté) :

```json
{
  "schemaVersion": 1,
  "etag": "6f1c…",
  "generatedAt": "2026-11-26T18:00:00.000Z",
  "channel": "v2",
  "channelName": "Assetown V2",
  "server": { "host": "play.assetown.fr", "port": 25565 },
  "build": {
    "id": "bld_…",
    "label": "Assetown V2 — Season Build 1",
    "changelog": "…",
    "minecraftVersion": "1.20.1",
    "loader": "fabric",
    "loaderVersion": "0.15.11",
    "loaderProfileUrl": null,
    "javaMinRam": 3072,
    "javaMaxRam": 6144,
    "jvmArgs": [],
    "gameArgs": [],
    "required": false,
    "publishedAt": "…"
  },
  "files": [
    {
      "path": "mods/example.jar",
      "sha256": "9d2f…",
      "size": 1234567,
      "url": "https://api.assetown.fr/api/downloads/bld_…?path=mods%2Fexample.jar&exp=…&sig=…",
      "kind": "mod",
      "required": true
    }
  ],
  "directories": ["mods", "config/assetown"],
  "protectedPaths": ["saves", "screenshots", "logs", "options.txt", "skins", "backups", "..."],
  "key": { "minRam": 3072, "maxRam": 6144 }
}
```

- Les URL de téléchargement sont **signées HMAC-SHA256** et expirent au bout de **12 h** (nouveau manifest = nouveaux liens). Une signature falsifiée ou expirée renvoie `403`.
- Le téléchargement supporte `Range` (reprise) et compte chaque fichier servi pour les statistiques.

## 4. Algorithme de synchronisation (launcher)

1. `preparing` — récupération du manifest (`If-None-Match` avec l'ETag local).
2. `checking` — pour chaque fichier :
   - chemin protégé → ignoré ;
   - état local identique (sha256 + taille) → conservé sans re-téléchargement ;
   - fichier présent de même taille → hash recalculé, conservé s'il correspond ;
   - sinon → mis en file de téléchargement.
3. Sauvegarde avant modification (si le build change) : `.assetown/`, `config/`, `options.txt`, `servers.dat` ; `mods/` si ≥ 20 fichiers changent (plafond 400 Mo) → `backups/<date>-<ancienBuild>/`.
4. `downloading` — 4 téléchargements parallèles, fichiers `.part`, reprise via `Range`, pause/reprise (les parties en cours sont reprises), vérification SHA-256 systématique, deuxième tentative automatique en cas de corruption.
5. `applying` — suppression des fichiers présents dans l'ancien état mais absents du nouveau manifest **uniquement** s'ils étaient gérés par Assetown et hors chemins protégés ; nettoyage des dossiers vides.
6. Écriture atomique de `.assetown/manifest.json` (buildId, etag, hashes), état `completed`.

`Réparation` relance la même procédure en **revérifiant tous les hashes** et en retéléchargeant uniquement les fichiers corrompus.

## 5. Chemins protégés (jamais modifiés ni supprimés)

`saves`, `screenshots`, `logs`, `crash-reports`, `options.txt`, `optionsof.txt`, `servers.dat`, `skins`, `config/assetown`, `resourcepacks`, `shaderpacks`, `journeymap`, `xaero`, `backups`.

Un fichier de build placé sous un chemin protégé est ignoré avec un avertissement dans le journal du launcher.

## 6. Minecraft et loaders

| Élément | Source | Vérification |
| --- | --- | --- |
| Version JSON | `piston-meta.mojang.com` (cache 1 h) | — |
| Client `.jar` | Mojang | SHA-1 |
| Bibliothèques | Mojang (règles OS/arch) | SHA-1 |
| Natives | classificateurs legacy | extraction `adm-zip` |
| Ressources | `resources.download.minecraft.net` | taille, puis index SHA-1 |
| Configuration log4j | Mojang logging | SHA-1 |
| Fabric | `meta.fabricmc.net/v2/versions/loader/<mc>/<ver>/profile/json` | cache local |
| Forge / NeoForge | URL JSON fournie par l'admin | HTTPS + test du build |

Le classpath final = bibliothèques vanilla + bibliothèques du loader + client jar. Les arguments `game`/`jvm` sont fusionnés, filtrés par règles et substitués (`${auth_player_name}`, `${game_directory}`, `${assets_root}`, `${natives_directory}`…).

Identité hors ligne : `uuid = MD5("OfflinePlayer:<pseudo>")` avec bits de version 3, `accessToken = "0"`, `userType = legacy` — identique au comportement d'un serveur `online-mode=false`.

## 7. Skins des comptes hors ligne

`PUT /api/me/skin?model=steve|alex` (PNG 64×64 ou 64×32, ≤ 2 Mo) → fichier stocké côté serveur, version précédente conservée (`POST /api/me/skin/restore`).

`GET /api/skins/<pseudo>.png` sert le skin courant. Pour l'afficher en jeu sur un serveur hors ligne, le serveur doit récupérer cette URL (plugin maison ou mod client capable de charger une URL d'API). Le panneau admin ne distribue pas de plugin : le contrat exposé est l'endpoint PNG public, à intégrer côté serveur.

## 8. Ajouter une nouvelle version du serveur

Les canaux `v1`, `v2`, `v3` sont créés au premier démarrage. Pour en ajouter un quatrième, insérez une ligne dans `channels` (slug, nom, host, port, accent) et étendez `CHANNELS` dans `packages/shared/src/index.ts` ainsi que les sélecteurs des launchers.
