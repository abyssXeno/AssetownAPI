import { useEffect, useState } from "react";
import type { ChannelSlug, ChannelSummary, UserProfile } from "@assetown/shared";
import type { JavaInfo } from "../../shared/types";
import { Modal } from "../components/Modal";
import { bridge } from "../lib/bridge";
import type { Lang } from "../lib/i18n";

export interface SettingsValues {
  apiBaseUrl: string;
  installDir: string;
  ramMinMb: number;
  ramMaxMb: number;
  resolutionWidth: number;
  resolutionHeight: number;
  fullscreen: boolean;
  language: Lang;
  autoStartOnBoot: boolean;
  closeOnLaunch: boolean;
  javaPath: string;
  jvmArgs: string;
  selectedChannel: ChannelSlug;
}

interface SettingsPageProps {
  settings: SettingsValues;
  user: UserProfile;
  channels: ChannelSummary[];
  selected: ChannelSlug;
  t: (key: string) => string;
  lang: Lang;
  onSaved: (settings: SettingsValues) => void;
  onUserUpdated: (user: UserProfile) => void;
  onLogout: () => void;
  onRepair: (channel: ChannelSlug) => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  busy: boolean;
}

const RESOLUTIONS = [
  { label: "1280 × 720", width: 1280, height: 720 },
  { label: "1600 × 900", width: 1600, height: 900 },
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "2560 × 1440", width: 2560, height: 1440 },
  { label: "3840 × 2160", width: 3840, height: 2160 },
];

export function SettingsPage({
  settings,
  user,
  channels,
  selected,
  t,
  lang,
  onSaved,
  onUserUpdated,
  onLogout,
  onRepair,
  notify,
  busy,
}: SettingsPageProps) {
  const [form, setForm] = useState<SettingsValues>(settings);
  const [java, setJava] = useState<JavaInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState({
    username: user.username,
    email: user.email,
    discord: user.discord ?? "",
    currentPassword: "",
    newPassword: "",
  });
  const [accountBusy, setAccountBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteForm, setDeleteForm] = useState({ password: "", confirmation: "" });

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    void bridge.game.detectedJava().then(setJava).catch(() => setJava(null));
  }, [form.javaPath]);

  const patch = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async (extra?: Partial<SettingsValues>) => {
    setSaving(true);
    try {
      const payload = { ...form, ...extra };
      const saved = (await bridge.settings.save(payload)) as unknown as SettingsValues;
      onSaved(saved);
      notify(t("settings.saved"), "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const changeLanguage = async (value: Lang) => {
    patch("language", value);
    try {
      const saved = (await bridge.settings.save({ language: value })) as unknown as SettingsValues;
      onSaved(saved);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const chooseDir = async () => {
    try {
      const dir = await bridge.settings.chooseInstallDir();
      if (dir) setForm((current) => ({ ...current, installDir: dir }));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const chooseJava = async () => {
    try {
      const path = await bridge.settings.chooseJava();
      if (path) setForm((current) => ({ ...current, javaPath: path }));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const clearCache = async () => {
    try {
      const result = await bridge.settings.clearCache();
      notify(
        lang === "fr"
          ? `${result.removedFiles} fichiers supprimés (${Math.round(result.freedBytes / 1024 / 1024)} Mo)`
          : `${result.removedFiles} files removed (${Math.round(result.freedBytes / 1024 / 1024)} MB)`,
        "success",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const resetSettings = async () => {
    try {
      const fresh = (await bridge.settings.reset()) as unknown as SettingsValues;
      onSaved(fresh);
      setForm(fresh);
      notify(lang === "fr" ? "Paramètres réinitialisés" : "Settings reset", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const saveAccount = async () => {
    setAccountBusy(true);
    try {
      const body: Record<string, string> = {};
      if (account.username !== user.username) body.username = account.username;
      if (account.email !== user.email) body.email = account.email;
      if ((account.discord || null) !== user.discord) body.discord = account.discord;
      if (account.newPassword) body.newPassword = account.newPassword;
      if (Object.keys(body).length === 0) {
        notify(lang === "fr" ? "Aucune modification" : "No change", "info");
        return;
      }
      if (body.username || body.email || body.newPassword) body.currentPassword = account.currentPassword;
      const result = await bridge.auth.updateProfile(body);
      onUserUpdated(result.user);
      setAccount((current) => ({ ...current, currentPassword: "", newPassword: "" }));
      notify(
        lang === "fr" ? "Informations du compte mises à jour" : "Account information updated",
        "success",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setAccountBusy(false);
    }
  };

  const resendVerification = async () => {
    try {
      await bridge.auth.resendVerification();
      notify(lang === "fr" ? "E-mail de vérification envoyé" : "Verification email sent", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const deleteAccount = async () => {
    try {
      await bridge.auth.deleteAccount(deleteForm.password, deleteForm.confirmation);
      setDeleteOpen(false);
      onLogout();
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const resolutionValue = `${form.resolutionWidth}x${form.resolutionHeight}`;

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>
            {lang === "fr"
              ? "Réglez la mémoire, l'affichage, la langue et les outils de maintenance de votre installation."
              : "Adjust memory, display, language and maintenance tools for your installation."}
          </p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving && <span className="spinner" />}
          {t("settings.save")}
        </button>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card stack" style={{ gap: 16 }}>
            <div className="row between">
              <h3>{t("settings.game")}</h3>
              <span className={`tag ${busy ? "" : "mono"}`}>{busy ? t("sync.downloading") : t("home.ready")}</span>
            </div>

            <div className="field">
              <label>
                {t("settings.ramMax")} — <span className="mono">{form.ramMaxMb} Mo</span>
              </label>
              <input
                type="range"
                min={1024}
                max={16384}
                step={512}
                value={form.ramMaxMb}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  patch("ramMaxMb", value);
                  if (value < form.ramMinMb) patch("ramMinMb", value);
                }}
              />
              <span className="help">
                {lang === "fr"
                  ? "Allouez 4 à 6 Go pour les builds chargés en mods. Ne dépassez pas la moitié de votre RAM totale."
                  : "Allocate 4–6 GB for heavily modded builds. Do not exceed half of your total RAM."}
              </span>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t("settings.ramMin")}</label>
                <input
                  className="input"
                  type="number"
                  min={512}
                  max={form.ramMaxMb}
                  step={256}
                  value={form.ramMinMb}
                  onChange={(event) => patch("ramMinMb", Number(event.target.value))}
                />
              </div>
              <div className="field">
                <label>{t("settings.ramMax")}</label>
                <input
                  className="input"
                  type="number"
                  min={form.ramMinMb}
                  max={32768}
                  step={256}
                  value={form.ramMaxMb}
                  onChange={(event) => patch("ramMaxMb", Number(event.target.value))}
                />
              </div>
            </div>

            <div className="field">
              <label>{t("settings.resolution")}</label>
              <select
                className="select"
                value={RESOLUTIONS.some((item) => `${item.width}x${item.height}` === resolutionValue) ? resolutionValue : "custom"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "custom") return;
                  const [width, height] = value.split("x").map(Number);
                  setForm((current) => ({ ...current, resolutionWidth: width, resolutionHeight: height }));
                }}
              >
                {RESOLUTIONS.map((item) => (
                  <option key={item.label} value={`${item.width}x${item.height}`}>
                    {item.label}
                  </option>
                ))}
                <option value="custom">
                  {lang === "fr" ? "Personnalisée" : "Custom"} ({form.resolutionWidth} × {form.resolutionHeight})
                </option>
              </select>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{lang === "fr" ? "Largeur" : "Width"}</label>
                <input
                  className="input"
                  type="number"
                  value={form.resolutionWidth}
                  onChange={(event) => patch("resolutionWidth", Number(event.target.value))}
                />
              </div>
              <div className="field">
                <label>{lang === "fr" ? "Hauteur" : "Height"}</label>
                <input
                  className="input"
                  type="number"
                  value={form.resolutionHeight}
                  onChange={(event) => patch("resolutionHeight", Number(event.target.value))}
                />
              </div>
            </div>

            <label className="switch">
              <input type="checkbox" checked={form.fullscreen} onChange={(event) => patch("fullscreen", event.target.checked)} />
              <span className="track" />
              <span className="label">{t("settings.fullscreen")}</span>
            </label>

            <div className="field">
              <label>{t("settings.jvmArgs")}</label>
              <input
                className="input"
                value={form.jvmArgs}
                onChange={(event) => patch("jvmArgs", event.target.value)}
                placeholder="-XX:+UseG1GC -Dsun.rmi.dgc.server.gcInterval=2147483646"
              />
            </div>
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <h3>{t("settings.java")}</h3>
            <div className="field">
              <label>{t("settings.javaPath")}</label>
              <div className="input-group">
                <input
                  className="input"
                  value={form.javaPath}
                  onChange={(event) => patch("javaPath", event.target.value)}
                  placeholder={lang === "fr" ? "Détection automatique" : "Automatic detection"}
                />
                <button className="btn small" onClick={() => void chooseJava()}>
                  {t("settings.chooseJava")}
                </button>
              </div>
              <span className="help">
                {java
                  ? `${t("settings.detected")} : Java ${java.version} (${java.major}) — ${java.path}`
                  : t("settings.none")}
              </span>
            </div>
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <h3>{lang === "fr" ? "Maintenance" : "Maintenance"}</h3>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn small" onClick={() => onRepair(selected)} disabled={busy}>
                {t("settings.repair")}
              </button>
              <button className="btn small" onClick={() => void clearCache()}>
                {t("settings.clearCache")}
              </button>
              <button className="btn small ghost" onClick={() => void resetSettings()}>
                {t("settings.reset")}
              </button>
              <button className="btn small ghost" onClick={() => void bridge.settings.openInstallDir(selected)}>
                {t("settings.open")}
              </button>
            </div>
            <span className="help">{t("settings.repairHint")}</span>
            <span className="help">
              {lang === "fr" ? "Version ciblée par la réparation :" : "Repair target version:"}{" "}
              <strong>{channels.find((channel) => channel.slug === selected)?.name ?? selected}</strong>
            </span>
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 14 }}>
            <h3>{t("settings.launcher")}</h3>

            <div className="field">
              <label>{t("settings.language")}</label>
              <select className="select" value={form.language} onChange={(event) => void changeLanguage(event.target.value as Lang)}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={form.autoStartOnBoot}
                onChange={(event) => patch("autoStartOnBoot", event.target.checked)}
              />
              <span className="track" />
              <span className="label">{t("settings.autoStart")}</span>
            </label>

            <label className="switch">
              <input
                type="checkbox"
                checked={form.closeOnLaunch}
                onChange={(event) => patch("closeOnLaunch", event.target.checked)}
              />
              <span className="track" />
              <span className="label">{t("settings.closeOnLaunch")}</span>
            </label>

            <div className="field">
              <label>{t("settings.installDir")}</label>
              <div className="input-group">
                <input className="input" value={form.installDir} onChange={(event) => patch("installDir", event.target.value)} />
                <button className="btn small" onClick={() => void chooseDir()}>
                  {t("settings.change")}
                </button>
              </div>
              <span className="help">
                {lang === "fr"
                  ? "Chaque version possède son propre dossier (mods, config, sauvegardes)."
                  : "Each version has its own folder (mods, config, saves)."}
              </span>
            </div>

            <div className="field">
              <label>{t("settings.api")}</label>
              <input
                className="input"
                value={form.apiBaseUrl}
                onChange={(event) => patch("apiBaseUrl", event.target.value)}
              />
              <span className="help">
                {lang === "fr"
                  ? "HTTPS obligatoire hors réseau local. Changer d'API déconnecte la session."
                  : "HTTPS required outside local network. Changing API signs you out."}
              </span>
            </div>

            <div className="field">
              <label>{lang === "fr" ? "Version par défaut" : "Default version"}</label>
              <select
                className="select"
                value={form.selectedChannel}
                onChange={(event) => patch("selectedChannel", event.target.value as ChannelSlug)}
              >
                {channels.map((channel) => (
                  <option key={channel.slug} value={channel.slug}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <div className="row between">
              <h3>{t("settings.account")}</h3>
              {user.emailVerified ? (
                <span className="tag" style={{ color: "var(--green)" }}>✓ {t("auth.verified")}</span>
              ) : (
                <button className="btn small" onClick={() => void resendVerification()}>
                  {t("auth.resend")}
                </button>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t("auth.username")}</label>
                <input
                  className="input"
                  value={account.username}
                  onChange={(event) => setAccount((current) => ({ ...current, username: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>{t("auth.discord")}</label>
                <input
                  className="input"
                  value={account.discord}
                  onChange={(event) => setAccount((current) => ({ ...current, discord: event.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label>{t("auth.email")}</label>
              <input
                className="input"
                type="email"
                value={account.email}
                onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t("settings.currentPassword")}</label>
                <input
                  className="input"
                  type="password"
                  value={account.currentPassword}
                  onChange={(event) => setAccount((current) => ({ ...current, currentPassword: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>{t("settings.newPassword")}</label>
                <input
                  className="input"
                  type="password"
                  value={account.newPassword}
                  onChange={(event) => setAccount((current) => ({ ...current, newPassword: event.target.value }))}
                />
              </div>
            </div>

            <button className="btn" onClick={() => void saveAccount()} disabled={accountBusy}>
              {accountBusy && <span className="spinner" />}
              {lang === "fr" ? "Mettre à jour mon compte" : "Update my account"}
            </button>

            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn small ghost" onClick={() => void bridge.auth.logout().then(onLogout)}>
                {t("settings.logout")}
              </button>
              <button className="btn small danger" onClick={() => setDeleteOpen(true)}>
                {t("settings.deleteAccount")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title={t("settings.deleteAccount")}
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <button className="btn ghost" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </button>
            <button className="btn danger" onClick={() => void deleteAccount()}>
              {t("common.delete")}
            </button>
          </>
        }
      >
        <p>
          {lang === "fr"
            ? "Cette action supprime définitivement votre compte, votre skin et vos sessions. Votre pseudo restera réservé."
            : "This permanently deletes your account, skin and sessions. Your username will stay reserved."}
        </p>
        <div className="field">
          <label>{t("auth.password")}</label>
          <input
            className="input"
            type="password"
            value={deleteForm.password}
            onChange={(event) => setDeleteForm((current) => ({ ...current, password: event.target.value }))}
          />
        </div>
        <div className="field">
          <label>{lang === "fr" ? `Tapez « ${user.username} » pour confirmer` : `Type "${user.username}" to confirm`}</label>
          <input
            className="input"
            value={deleteForm.confirmation}
            onChange={(event) => setDeleteForm((current) => ({ ...current, confirmation: event.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}
