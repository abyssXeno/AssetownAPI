export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 100 || power === 0 ? 0 : 1)} ${units[power]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDate(iso: string | null, lang: "fr" | "en" = "fr"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null, lang: "fr" | "en" = "fr"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | null, lang: "fr" | "en" = "fr"): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return lang === "fr" ? "à l'instant" : "just now";
  if (minutes < 60) return lang === "fr" ? `il y a ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === "fr" ? `il y a ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return lang === "fr" ? `il y a ${days} j` : `${days} d ago`;
  return formatDate(iso, lang);
}

export function formatEta(seconds: number | null, lang: "fr" | "en" = "fr"): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return lang === "fr" ? `${minutes} min ${rest}s` : `${minutes}m ${rest}s`;
}

export function loaderLabel(loader: string): string {
  switch (loader) {
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    default:
      return "Vanilla";
  }
}

export function channelGradient(slug: string, accent?: string): string {
  const base = accent ?? (slug === "v1" ? "#7c5cff" : slug === "v2" ? "#3ea8ff" : "#ff5c9d");
  return `linear-gradient(135deg, ${base}33, transparent 65%)`;
}
