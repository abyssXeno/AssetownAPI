/**
 * Jeu de données initial : canaux, compte administrateur, annonces de
 * démonstration et un build de démonstration pour tester la synchronisation.
 *
 *   npm run seed -w @assetown/backend            → builds de démo en brouillon testé
 *   npm run seed -w @assetown/backend -- --publish → publie le build de démo V2
 */
import fs from "node:fs";
import path from "node:path";
import { all, one, run } from "./db.js";
import { BUILD_STORAGE } from "./env.js";
import { bootstrap } from "./bootstrap.js";
import { activeBuild, fileUrl, getChannel, getBuild, buildStats } from "./builds.js";
import { audit } from "./audit.js";
import { ensureDir, now, sha256, uid } from "./util.js";
import { fileSha256 } from "./util.js";

const publish = process.argv.includes("--publish");
const boot = bootstrap();

if (boot.created) {
  console.log(`Administrateur initial créé : ${boot.email} / ${boot.password}`);
  console.log(`Identifiants écrits dans ${boot.file}`);
}

const demoAnnouncements = [
  {
    type: "news",
    title: "Assetown ouvre ses portes sur trois univers",
    body:
      "V1, V2 et V3 sont désormais accessibles depuis un seul launcher. Choisissez votre version, le launcher installe automatiquement les mods et configurations nécessaires.\n\nRejoignez le Discord pour suivre les temps forts de la saison.",
    pinned: 1,
    linkLabel: "Rejoindre le Discord",
    linkUrl: "https://discord.gg/assetown",
  },
  {
    type: "event",
    title: "Lancement de la saison V3 — ce samedi 20h",
    body:
      "Rendez-vous sur Assetown V3 pour l'ouverture officielle : donjons inédits, marché communautaire et cadeaux de lancement pour les premiers connectés.",
    pinned: 0,
    eventInDays: 5,
    linkLabel: null,
    linkUrl: null,
  },
  {
    type: "maintenance",
    title: "Maintenance hebdomadaire — mercredi 4h",
    body: "Une maintenance de routine aura lieu mercredi entre 4h et 5h. Les serveurs redémarreront automatiquement. Aucune perte de progression n'est à prévoir.",
    pinned: 0,
    linkLabel: null,
    linkUrl: null,
  },
];

if (one<{ n: number }>("SELECT COUNT(*) as n FROM announcements")!.n === 0) {
  for (const item of demoAnnouncements) {
    const eventAt = "eventInDays" in item && item.eventInDays ? new Date(Date.now() + item.eventInDays * 86400000).toISOString() : null;
    run(
      `INSERT INTO announcements (id, type, title, body, image_url, link_url, link_label, pinned, published_at, expires_at, event_at, author, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, 'Assetown', ?, ?)`,
      uid("ann"),
      item.type,
      item.title,
      item.body,
      item.linkUrl,
      item.linkLabel,
      item.pinned,
      new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      eventAt,
      now(),
      now(),
    );
  }
  console.log("Annonces de démonstration créées.");
}

function writeBuildFile(buildId: string, relativePath: string, content: string, kind = "config"): void {
  const target = path.join(ensureDir(path.join(BUILD_STORAGE, buildId, path.posix.dirname(relativePath))), path.posix.basename(relativePath));
  fs.writeFileSync(target, content, "utf8");
  const buffer = Buffer.from(content, "utf8");
  run(
    `INSERT INTO build_files (id, build_id, path, size, sha256, kind, required, storage_path)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    uid("bf"),
    buildId,
    relativePath,
    buffer.length,
    sha256(buffer),
    kind,
    target,
  );
}

async function createDemoBuild(channelSlug: "v1" | "v2" | "v3", label: string, minecraftVersion: string, loader: string, loaderVersion: string): Promise<void> {
  const channel = getChannel(channelSlug);
  if (!channel) return;
  if (channel.active_build_id) {
    console.log(`Build déjà actif sur ${channelSlug}, aucun build de démonstration créé.`);
    return;
  }
  const existing = one<{ n: number }>("SELECT COUNT(*) as n FROM builds WHERE channel = ?", channelSlug);
  if (existing && existing.n > 0) {
    console.log(`Des builds existent déjà pour ${channelSlug}.`);
    return;
  }

  const id = uid("bld");
  run(
    `INSERT INTO builds (id, channel, label, description, changelog, minecraft_version, loader, loader_version,
      loader_profile_url, java_min_ram, java_max_ram, jvm_args, game_args, required, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 3072, 6144, '[]', '[]', 0, 'tested', NULL, ?, ?)`,
    id,
    channelSlug,
    label,
    "Build de démonstration — remplacez-le par vos vrais mods et configurations depuis le panneau d'administration.",
    "• Build de démonstration généré par le script de seed\n• Sert à valider la synchronisation, les hashes et la barre de progression",
    minecraftVersion,
    loader,
    loaderVersion,
    now(),
    now(),
  );

  writeBuildFile(
    id,
    "config/assetown/README.txt",
    `Assetown — ${label}\n\nCe fichier est fourni par le launcher Assetown et synchronisé automatiquement.\nVersion Minecraft : ${minecraftVersion}\nLoader : ${loader} ${loaderVersion}\n\nNe modifiez pas ce fichier : il sera remplacé à la prochaine mise à jour.\n`,
  );
  writeBuildFile(
    id,
    "config/assetown/settings.json",
    JSON.stringify(
      {
        shaderPreset: "balanced",
        hudScale: 1,
        chatOpacity: 0.85,
        fov: 80,
        language: "fr_fr",
        managedBy: "Assetown Launcher",
      },
      null,
      2,
    ),
  );
  writeBuildFile(
    id,
    "config/assetown/keybinds.json",
    JSON.stringify({ zoom: "KEY_V", voice: "KEY_B", quests: "KEY_J", managedBy: "Assetown Launcher" }, null, 2),
  );
  console.log(`Build de démonstration créé pour ${channelSlug} (${label}) — ${buildStats(id).fileCount} fichiers.`);

  const files = all<{ storage_path: string; sha256: string; path: string }>("SELECT storage_path, sha256, path FROM build_files WHERE build_id = ?", id);
  for (const file of files) {
    const digest = await fileSha256(file.storage_path);
    if (digest !== file.sha256) throw new Error(`Hash incohérent pour ${file.path}`);
  }

  if (publish) {
    run("UPDATE builds SET status = 'published', published_at = ? WHERE id = ?", now(), id);
    run("UPDATE channels SET active_build_id = ? WHERE slug = ?", id, channelSlug);
    audit({ id: null, label: "system:seed" }, "build.publish", id, { channel: channelSlug, demo: true });
    const build = getBuild(id)!;
    console.log(`Build publié : ${build.label}`);
    console.log(`Manifest : ${fileUrl(id, "config/assetown/README.txt").split("?")[0]}`);
  }
}

await createDemoBuild("v2", "Assetown V2 — Season Build 1", "1.20.1", "fabric", "0.15.11");

if (publish) {
  const active = activeBuild("v2");
  if (active) console.log(`Canal V2 actif : ${active.label}`);
}
console.log("Seed terminé.");
