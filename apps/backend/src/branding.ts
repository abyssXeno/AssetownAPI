import { getSetting, setSetting } from "./db.js";

export interface Branding {
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
}

const DEFAULTS: Branding = {
  brandName: "Assetown",
  logoUrl: null,
  bannerUrl: null,
  discordUrl: "https://discord.gg/assetown",
  websiteUrl: "https://assetown.fr",
  storeUrl: null,
  supportUrl: null,
  welcomeTitle: "Bienvenue sur Assetown",
  welcomeText:
    "Trois univers, une seule communauté. Choisissez votre version, laissez le launcher préparer vos fichiers et rejoignez le serveur en quelques secondes.",
  maintenance: { enabled: false, message: "" },
};

export function getBranding(): Branding {
  return {
    brandName: getSetting("brand_name", DEFAULTS.brandName),
    logoUrl: getSetting("logo_url", "") || null,
    bannerUrl: getSetting("banner_url", "") || null,
    discordUrl: getSetting("discord_url", DEFAULTS.discordUrl ?? "") || null,
    websiteUrl: getSetting("website_url", DEFAULTS.websiteUrl ?? "") || null,
    storeUrl: getSetting("store_url", "") || null,
    supportUrl: getSetting("support_url", "") || null,
    welcomeTitle: getSetting("welcome_title", DEFAULTS.welcomeTitle),
    welcomeText: getSetting("welcome_text", DEFAULTS.welcomeText),
    maintenance: {
      enabled: getSetting("maintenance_enabled", "0") === "1",
      message: getSetting("maintenance_message", ""),
    },
  };
}

export function saveBranding(input: Partial<Branding>): Branding {
  if (typeof input.brandName === "string" && input.brandName.trim()) setSetting("brand_name", input.brandName.trim().slice(0, 40));
  if (input.logoUrl !== undefined) setSetting("logo_url", input.logoUrl ?? "");
  if (input.bannerUrl !== undefined) setSetting("banner_url", input.bannerUrl ?? "");
  if (input.discordUrl !== undefined) setSetting("discord_url", input.discordUrl ?? "");
  if (input.websiteUrl !== undefined) setSetting("website_url", input.websiteUrl ?? "");
  if (input.storeUrl !== undefined) setSetting("store_url", input.storeUrl ?? "");
  if (input.supportUrl !== undefined) setSetting("support_url", input.supportUrl ?? "");
  if (typeof input.welcomeTitle === "string") setSetting("welcome_title", input.welcomeTitle.slice(0, 120));
  if (typeof input.welcomeText === "string") setSetting("welcome_text", input.welcomeText.slice(0, 600));
  if (input.maintenance) {
    setSetting("maintenance_enabled", input.maintenance.enabled ? "1" : "0");
    setSetting("maintenance_message", (input.maintenance.message ?? "").slice(0, 400));
  }
  return getBranding();
}
