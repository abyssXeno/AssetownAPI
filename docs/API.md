# RÉFÉRENCE API

Base : `PUBLIC_BASE_URL` (HTTPS en production). Réponses JSON : `{ ... }` ou `{ "error": { "code", "message" } }`.
Authentification : `Authorization: Bearer <accessToken>`.

## Public (sans jeton)

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/api/health` | État du service |
| GET | `/api/config` | Marque, bannière, liens, 3 versions + état des serveurs Minecraft (ping) |
| GET | `/api/news?limit=20` | Annonces publiées (épinglées en tête, expirées exclues) |
| GET | `/api/notifications` | Annonces + derniers builds publiés |
| GET | `/api/builds/:channel/manifest` | Manifest de mise à jour (ETag → 304) |
| GET | `/api/builds/:channel/history` | Builds publiés/archivés du canal |
| GET | `/api/downloads/:buildId?path&exp&sig` | Téléchargement signé (Range supporté) |
| GET | `/api/skins/:username.png` | Skin courant |
| GET | `/api/skins/:username/previous.png` | Skin précédent |
| GET | `/api/uploads/:file` | Images d'annonces/bannières |
| GET | `/api/server-status/:channel` | Ping Minecraft détaillé |
| POST | `/api/telemetry/download` \| `/api/telemetry/launch` | Compteurs anonymes |
| GET | `/api/auth/verify-email?token=` | Page de confirmation d'e-mail |
| GET | `/reset-password?token=` | Page web de réinitialisation |

## Comptes

| Méthode | Route | Corps |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ email, username, password, discord, acceptedTerms }` → `201` + session |
| POST | `/api/auth/login` | `{ identifier, password }` (e-mail **ou** pseudo) |
| POST | `/api/auth/refresh` | `{ refreshToken }` → rotation |
| POST | `/api/auth/logout` | `{ refreshToken }` |
| POST | `/api/auth/forgot-password` | `{ email }` (réponse neutre) |
| POST | `/api/auth/reset-password` | `{ token, password }` |
| POST | `/api/auth/verify-email` | `{ token }` |
| POST | `/api/auth/resend-verification` | — (authentifié) |
| GET | `/api/me` | Profil + skin |
| PATCH | `/api/me` | `{ username?, email?, discord?, currentPassword?, newPassword?, skinModel? }` |
| DELETE | `/api/me` | `{ password, confirmation: "<pseudo>" }` |
| PUT | `/api/me/skin?model=steve\|alex` | Corps binaire PNG |
| POST | `/api/me/skin/restore` | — |
| GET | `/api/me/sessions` | Sessions actives |
| POST | `/api/me/sessions/revoke-all` | Révoque toutes les sessions |
| POST | `/api/support/reports` | `{ subject, message, logs?, system? }` |

## Administration (rôle ≠ player + permission)

| Méthode | Route | Permission |
| --- | --- | --- |
| POST | `/api/admin/auth/login` | — (refus si `player`) |
| GET | `/api/admin/me` | staff |
| GET | `/api/admin/dashboard` | `dashboard.view` |
| GET | `/api/admin/players?q&limit&offset` | `players.view` |
| PATCH | `/api/admin/players/:id` | `players.manage` |
| DELETE | `/api/admin/players/:id` | `players.manage` + owner |
| GET | `/api/admin/builds?channel` | `builds.view` |
| POST | `/api/admin/builds` | `builds.edit` |
| PATCH / DELETE | `/api/admin/builds/:id` | `builds.edit` |
| PUT | `/api/admin/builds/:id/files?path&kind` | `builds.edit` (corps binaire) |
| DELETE | `/api/admin/builds/:id/files?path` | `builds.edit` |
| POST | `/api/admin/builds/:id/test` | `builds.edit` |
| POST | `/api/admin/builds/:id/publish` | `builds.publish` + `{ confirm: true }` |
| POST | `/api/admin/builds/:id/rollback` | `builds.publish` + `{ confirm: true }` |
| GET | `/api/admin/channels` | `builds.view` |
| PATCH | `/api/admin/channels/:slug` | `settings.manage` |
| GET / POST | `/api/admin/announcements` | `announcements.manage` |
| PATCH / DELETE | `/api/admin/announcements/:id` | `announcements.manage` |
| PUT | `/api/admin/uploads/images` | `announcements.manage` (PNG/JPEG/WebP) |
| GET | `/api/admin/audit?limit` | `audit.view` |
| GET | `/api/admin/reports` | `reports.manage` |
| GET | `/api/admin/reports/:id` | `reports.manage` (rapport + journaux) |
| PATCH | `/api/admin/reports/:id` | `reports.manage` (`open`/`in_progress`/`closed`) |
| GET / PATCH | `/api/admin/settings` | `settings.manage` |
| GET | `/api/admin/meta` | staff |

## Codes d'erreur notables

`invalid_credentials`, `username_taken`, `email_taken`, `weak_password`, `account_disabled`, `token_expired`, `invalid_session`, `rate_limited` (429), `forbidden`, `channel_disabled` (409), `no_build` (404), `invalid_signature` (403), `build_not_tested` (409), `confirmation_required` (428), `payload_too_large` (413).
