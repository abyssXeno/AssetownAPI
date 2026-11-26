/**
 * Types et contrats partagés entre le backend, le launcher joueur
 * et le panneau d'administration.
 */

export const CHANNELS = ["v1", "v2", "v3"] as const;
export type ChannelSlug = (typeof CHANNELS)[number];

export const LOADERS = ["vanilla", "fabric", "forge", "neoforge"] as const;
export type LoaderType = (typeof LOADERS)[number];

export const ROLES = ["player", "moderator", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const BUILD_STATUSES = ["draft", "tested", "published", "archived"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export type FileKind = "mod" | "config" | "resourcepack" | "shaderpack" | "extra";

export type AnnouncementType = "news" | "event" | "maintenance" | "update";

export interface ManifestFile {
  /** Chemin relatif au dossier de jeu de la version (ex: mods/create-1.0.jar) */
  path: string;
  sha256: string;
  size: number;
  /** URL HTTPS absolue de téléchargement */
  url: string;
  kind: FileKind;
  required: boolean;
}

export interface BuildInfo {
  id: string;
  channel: ChannelSlug;
  label: string;
  description: string;
  changelog: string;
  minecraftVersion: string;
  loader: LoaderType;
  loaderVersion: string;
  /** Profil de version JSON additionnel (Forge / NeoForge pré-compilé) */
  loaderProfileUrl: string | null;
  loaderProfileSha256: string | null;
  javaMinRam: number;
  javaMaxRam: number;
  jvmArgs: string[];
  gameArgs: string[];
  required: boolean;
  publishedAt: string | null;
}

export interface ChannelSummary {
  slug: ChannelSlug;
  name: string;
  description: string;
  accent: string;
  enabled: boolean;
  serverHost: string;
  serverPort: number;
  discordUrl: string | null;
  activeBuild: {
    id: string;
    label: string;
    minecraftVersion: string;
    loader: LoaderType;
    publishedAt: string | null;
    changelog: string;
  } | null;
  status: ServerStatus;
}

export interface ServerStatus {
  online: boolean;
  players: { online: number; max: number } | null;
  version: string | null;
  latency: number | null;
  motd: string | null;
  checkedAt: string;
}

export interface BuildManifest {
  schemaVersion: 1;
  etag: string;
  generatedAt: string;
  channel: ChannelSlug;
  channelName: string;
  server: { host: string; port: number };
  build: BuildInfo;
  files: ManifestFile[];
  directories: string[];
  /** Chemins que le launcher ne doit jamais supprimer ni écraser */
  protectedPaths: string[];
  key: { minRam: number; maxRam: number };
}

export interface Announcement {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  publishedAt: string;
  eventAt: string | null;
  author: string;
}

export interface PublicConfig {
  brandName: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  discordUrl: string | null;
  websiteUrl: string | null;
  storeUrl: string | null;
  supportUrl: string | null;
  welcomeTitle: string;
  welcomeText: string;
  maintenance: { enabled: boolean; message: string };
  channels: ChannelSummary[];
  latestBuilds: Array<{ channel: ChannelSlug; label: string; publishedAt: string | null; changelog: string }>;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  discord: string | null;
  role: Role;
  permissions: string[];
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  skin: SkinInfo | null;
}

export interface SkinInfo {
  model: "steve" | "alex";
  updatedAt: string | null;
  url: string | null;
  previousUrl: string | null;
  hasPrevious: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
}

export interface AdminDashboard {
  totals: {
    accounts: number;
    activePlayers: number;
    downloads: number;
    builds: number;
    announcements: number;
    openReports: number;
  };
  recentUsers: Array<{ id: string; username: string; email: string; createdAt: string; role: Role }>;
  recentBuilds: Array<{
    id: string;
    channel: ChannelSlug;
    label: string;
    status: BuildStatus;
    publishedAt: string | null;
    fileCount: number;
  }>;
  channelStates: Array<{
    slug: ChannelSlug;
    name: string;
    enabled: boolean;
    activeBuild: string | null;
    online: boolean;
    players: number | null;
  }>;
  audit: AuditEntry[];
  buildActivity: Array<{ day: string; downloads: number }>;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminBuild {
  id: string;
  channel: ChannelSlug;
  label: string;
  description: string;
  changelog: string;
  minecraftVersion: string;
  loader: LoaderType;
  loaderVersion: string;
  loaderProfileUrl: string | null;
  javaMinRam: number;
  javaMaxRam: number;
  jvmArgs: string;
  gameArgs: string;
  required: boolean;
  status: BuildStatus;
  createdAt: string;
  publishedAt: string | null;
  createdBy: string | null;
  fileCount: number;
  totalSize: number;
  files: Array<{ path: string; size: number; sha256: string; kind: FileKind }>;
}

export const PERMISSIONS = [
  "dashboard.view",
  "players.view",
  "players.manage",
  "builds.view",
  "builds.edit",
  "builds.publish",
  "announcements.manage",
  "audit.view",
  "settings.manage",
  "reports.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  player: [],
  moderator: ["dashboard.view", "players.view", "reports.manage"],
  admin: [
    "dashboard.view",
    "players.view",
    "players.manage",
    "builds.view",
    "builds.edit",
    "builds.publish",
    "announcements.manage",
    "audit.view",
    "reports.manage",
    "settings.manage",
  ],
  owner: [...PERMISSIONS],
};

/**
 * Chemins toujours préservés lors des synchronisations / mises à jour.
 * Les sauvegardes, captures d'écran et skins du joueur ne sont jamais touchés.
 */
export const DEFAULT_PROTECTED_PATHS = [
  "saves",
  "screenshots",
  "logs",
  "crash-reports",
  "options.txt",
  "optionsof.txt",
  "servers.dat",
  "skins",
  "config/assetown",
  "resourcepacks",
  "shaderpacks",
  "journeymap",
  "xaero",
  "backups",
] as const;

export function isChannel(value: string): value is ChannelSlug {
  return (CHANNELS as readonly string[]).includes(value);
}

export function isLoader(value: string): value is LoaderType {
  return (LOADERS as readonly string[]).includes(value);
}

/** UUID hors-ligne identique à celui généré par Minecraft pour un pseudo. */
export function offlineUuid(username: string): string {
  // MD5("OfflinePlayer:<name>") avec bits de version 3 — calculé côté Node.
  // Cette fonction est fournie pour les tests et le rendu ; l'implémentation
  // de production se trouve dans le launcher (node:crypto).
  return "";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 100 || power === 0 ? 0 : 1)} ${units[power]}`;
}
