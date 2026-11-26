# GUIDE ADMINISTRATEUR — ASSETOWN ADMIN PANEL

## 1. Rôles et permissions

| Rôle | Accès par défaut |
| --- | --- |
| `player` | Aucun accès au panneau (connexion refusée) |
| `moderator` | Tableau de bord, joueurs (lecture), rapports de support |
| `admin` | + gestion des joueurs, builds (édition/publication), annonces, audit, paramètres |
| `owner` | Toutes les permissions + suppression de comptes + nomination d'autres `owner` |

Permissions fines (`packages/shared/src/index.ts`) : `dashboard.view`, `players.view`, `players.manage`, `builds.view`, `builds.edit`, `builds.publish`, `announcements.manage`, `audit.view`, `settings.manage`, `reports.manage`.

Elles peuvent être ajoutées individuellement à un compte (en base, table `users.permissions`, JSON `["builds.publish"]`) en plus de celles du rôle.

**Garde-fous serveur** : impossible de modifier son propre rôle ou de se désactiver, de modifier un compte de rang supérieur, de publier un build non testé, ou de supprimer le build actif d'une version.

## 2. Tableau de bord

- Comptes créés, joueurs actifs (7 jours), téléchargements cumulés (compteur réel des fichiers servis), builds, annonces, rapports ouverts.
- Graphique des téléchargements sur 14 jours.
- Derniers inscrits, derniers builds (statut, nombre de fichiers), état des trois versions (en ligne / hors ligne + joueurs connectés via ping Minecraft), 10 dernières actions d'audit.
- Rafraîchissement automatique toutes les 45 s.

## 3. Workflow de publication d'un build

1. **Builds & versions → + Nouveau build**
   Canal (V1/V2/V3), nom, version Minecraft (`1.20.1`), loader (`vanilla`, `fabric`, `forge`, `neoforge`), version du loader, description.
2. **Paramètres du build** : description, journal des modifications (visible par les joueurs), RAM min/max, arguments JVM/jeu (un par ligne), build « requis ».
   - **Fabric** : la version du loader suffit — le launcher télécharge le profil officiel `meta.fabricmc.net`.
   - **Forge / NeoForge** : renseignez l'**URL HTTPS du profil JSON** de version produit par l'installateur. Sans ce profil, le test renvoie un avertissement et le lancement échoue avec un message explicite.
3. **Fichiers**
   - `+ Mods (.jar)` : envoi multiple, rangé automatiquement dans `mods/`.
   - `+ Configs` : rangé dans `config/`.
   - Chemin personnalisé : par exemple `config/fancymenu/options.txt`, `resourcepacks/mon-pack.zip`, `shaderpacks/pack.zip`.
   - Chaque fichier est haché en SHA-256 à l'envoi ; la liste affiche chemin, taille, kind et empreinte.
4. **Tester** : vérifie l'existence et le hash de chaque fichier sur le stockage, la version Minecraft, la cohérence RAM et le profil de loader. Statut → `tested` si aucune erreur (les avertissements n'empêchent pas la publication).
5. **Publier le build** : confirmation explicite obligatoire, journal de modifications, puis :
   - le build précédent passe en `archived` ;
   - le build courant passe en `published` et devient `channels.active_build_id` ;
   - les launchers détectent le nouveau manifest au lancement suivant (ETag).
6. **Retour arrière** : sur un build `archived`, bouton **Réactiver** (confirmation requise). L'audit conserve chaque publication/rollback.

Toute modification de fichier ou de métadonnées remet le build en `draft` : il faut re-tester avant de publier (protection contre les publications accidentelles).

### Désactiver une version

**Builds & versions → Versions du serveur → Configurer** : nom, description, hôte/port Minecraft, couleur d'accent, Discord, et interrupteur « Version accessible dans le launcher ». Une version désactivée renvoie `409` sur son manifest et apparaît grisée côté joueur.

## 4. Annonces

- Types : actualité, événement, maintenance, mise à jour.
- Champs : titre, contenu, image (upload PNG/JPEG/WebP, 8 Mo max), lien externe + libellé, épinglage, date de publication (publication programmée possible), expiration, date d'événement.
- Les annonces épinglées remontent en tête ; les événements à venir apparaissent dans la colonne « Événements à venir » du launcher.
- Aucune mise à jour du logiciel n'est nécessaire : le launcher rafraîchit `/api/news` et `/api/notifications` (au démarrage et toutes les 90 s).

## 5. Joueurs

- Recherche par pseudo, e-mail ou Discord ; pagination 25.
- Colonnes : pseudo (avatar skin), e-mail + statut de vérification, Discord, rôle, inscription, dernière connexion, état.
- Actions : changer le rôle, désactiver/réactiver (révoque immédiatement les sessions), supprimer (owner uniquement — le pseudo reste réservé).
- Chaque action est écrite dans le journal d'audit avec l'auteur, la cible et l'IP.

## 6. Rapports de support

Les joueurs envoient un rapport depuis le launcher (sujet, description, journaux optionnels). Le panneau permet d'ouvrir le rapport, lire les journaux joints, le passer en « en cours » ou « clos » (réouverture possible).

## 7. Journal d'audit

Actions tracées : connexions admin (succès/échec), création/modification/test/publication/rollback/suppression de build, upload/suppression de fichiers, création/modification/suppression d'annonces, mise à jour/suppression de comptes, changements de version, paramètres, uploads d'images, rapports. Filtrable côté console, conservé en base (`audit_log`).

## 8. Personnalisation

Paramètres : nom de la marque, titre et texte de bienvenue, logo, bannière, liens Discord/site/boutique/support, bandeau de maintenance. L'URL de l'API utilisée par la console est modifiable et force une reconnexion.

## 9. Bonnes pratiques sécurité

- Changez le mot de passe initial, utilisez un gestionnaire de secrets.
- Un seul `owner` actif ; les `admin` n'ont pas besoin de `settings.manage` sauf nécessité.
- Servez l'API **derrière HTTPS** ; n'ouvrez pas le port 4200 publiquement.
- Sauvegardez `assetown.db`, `secret.key` et `storage/builds/` quotidiennement.
- Relisez le journal d'audit après chaque session de publication.
- Testez toujours un build avant publication : les joueurs reçoivent le build immédiatement après.
