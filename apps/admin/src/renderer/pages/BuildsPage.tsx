import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminBuild, ChannelSlug, FileKind, LoaderType, Permission, ServerStatus } from "@assetown/shared";
import { api, bridge } from "../lib/bridge";
import { Modal, ConfirmModal } from "../components/Modal";

interface ChannelRow {
  slug: ChannelSlug;
  name: string;
  description: string;
  accent: string;
  enabled: boolean;
  serverHost: string;
  serverPort: number;
  discordUrl: string | null;
  activeBuildId: string | null;
  activeBuildLabel: string | null;
  activeBuildMinecraft: string | null;
  activeBuildLoader: string | null;
  status: ServerStatus;
}

interface BuildsPageProps {
  user: { id: string; username: string; role: string };
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  can: (permission: Permission) => boolean;
}

const LOADERS: Array<{ value: LoaderType; label: string }> = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, power)).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

interface BuildForm {
  label: string;
  description: string;
  changelog: string;
  minecraftVersion: string;
  loader: LoaderType;
  loaderVersion: string;
  loaderProfileUrl: string;
  javaMinRam: number;
  javaMaxRam: number;
  jvmArgs: string;
  gameArgs: string;
  required: boolean;
}

export function BuildsPage({ notify, can }: BuildsPageProps) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [builds, setBuilds] = useState<AdminBuild[]>([]);
  const [filter, setFilter] = useState<"all" | ChannelSlug>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BuildForm | null>(null);
  const [issues, setIssues] = useState<Array<{ severity: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishChangelog, setPublishChangelog] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [channelEdit, setChannelEdit] = useState<ChannelRow | null>(null);
  const [newBuild, setNewBuild] = useState({
    channel: "v2" as ChannelSlug,
    label: "",
    minecraftVersion: "1.20.1",
    loader: "fabric" as LoaderType,
    loaderVersion: "",
    description: "",
  });
  const [customPath, setCustomPath] = useState("");

  const editable = can("builds.edit");
  const canPublish = can("builds.publish");

  const loadAll = useCallback(
    async (keepSelection = true) => {
      try {
        const [channelData, buildData] = await Promise.all([
          api.get<{ channels: ChannelRow[] }>("/api/admin/channels"),
          api.get<{ builds: AdminBuild[] }>("/api/admin/builds"),
        ]);
        setChannels(channelData.channels);
        setBuilds(buildData.builds);
        if (buildData.builds.length > 0) {
          setSelectedId((current) => {
            if (keepSelection && current && buildData.builds.some((build) => build.id === current)) return current;
            return buildData.builds[0].id;
          });
        } else {
          setSelectedId(null);
        }
      } catch (error) {
        notify((error as Error).message, "error");
      }
    },
    [notify],
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selected = useMemo(() => builds.find((build) => build.id === selectedId) ?? null, [builds, selectedId]);

  useEffect(() => {
    setIssues([]);
    if (!selected) {
      setForm(null);
      return;
    }
    setForm({
      label: selected.label,
      description: selected.description,
      changelog: selected.changelog,
      minecraftVersion: selected.minecraftVersion,
      loader: selected.loader,
      loaderVersion: selected.loaderVersion,
      loaderProfileUrl: selected.loaderProfileUrl ?? "",
      javaMinRam: selected.javaMinRam,
      javaMaxRam: selected.javaMaxRam,
      jvmArgs: (() => {
        try {
          return (JSON.parse(selected.jvmArgs) as string[]).join("\n");
        } catch {
          return selected.jvmArgs;
        }
      })(),
      gameArgs: (() => {
        try {
          return (JSON.parse(selected.gameArgs) as string[]).join("\n");
        } catch {
          return selected.gameArgs;
        }
      })(),
      required: selected.required,
    });
  }, [selected]);

  const visibleBuilds = useMemo(
    () => (filter === "all" ? builds : builds.filter((build) => build.channel === filter)),
    [builds, filter],
  );

  const patch = <K extends keyof BuildForm>(key: K, value: BuildForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const createBuild = async () => {
    setBusy(true);
    try {
      const data = await api.post<{ build: AdminBuild }>("/api/admin/builds", newBuild);
      setCreateOpen(false);
      setNewBuild({ channel: newBuild.channel, label: "", minecraftVersion: newBuild.minecraftVersion, loader: newBuild.loader, loaderVersion: "", description: "" });
      await loadAll(false);
      setSelectedId(data.build.id);
      notify(`Build créé : ${data.build.label}`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveBuild = async () => {
    if (!selected || !form) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/builds/${selected.id}`, {
        ...form,
        loaderProfileUrl: form.loaderProfileUrl || null,
        jvmArgs: form.jvmArgs,
        gameArgs: form.gameArgs,
      });
      await loadAll();
      notify("Build enregistré. Relancez le test avant publication.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const testBuild = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const data = await api.post<{
        ok: boolean;
        issues: Array<{ severity: string; message: string }>;
        fileCount: number;
      }>(`/api/admin/builds/${selected.id}/test`);
      setIssues(data.issues);
      await loadAll();
      notify(
        data.ok
          ? `Build validé (${data.fileCount} fichier(s)). Vous pouvez publier.`
          : "Le test a relevé des erreurs : corrigez-les avant publication.",
        data.ok ? "success" : "error",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/builds/${selected.id}/publish`, {
        confirm: true,
        changelog: publishChangelog,
      });
      setPublishOpen(false);
      await loadAll();
      notify(`Build publié sur ${selected.channel.toUpperCase()} — les launchers détecteront la mise à jour.`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/builds/${selected.id}/rollback`, { confirm: true });
      await loadAll();
      notify("Build réactivé.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeBuild = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/builds/${selected.id}`);
      setDeleteOpen(false);
      setSelectedId(null);
      await loadAll(false);
      notify("Build supprimé.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (kind: FileKind) => {
    if (!selected) return;
    try {
      const files = await bridge.pickFiles();
      if (files.length === 0) return;
      setBusy(true);
      for (const file of files) {
        await bridge.uploadBuildFile(selected.id, file.path, undefined, kind);
      }
      await loadAll();
      notify(`${files.length} fichier(s) ajouté(s) au build.`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadCustom = async () => {
    if (!selected || !customPath.trim()) {
      notify("Indiquez le chemin cible (ex: config/mymod.toml).", "error");
      return;
    }
    try {
      const files = await bridge.pickFiles();
      if (files.length === 0) return;
      setBusy(true);
      await bridge.uploadBuildFile(selected.id, files[0].path, customPath.trim(), undefined);
      setCustomPath("");
      await loadAll();
      notify("Fichier ajouté.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (path: string) => {
    if (!selected) return;
    try {
      await api.delete(`/api/admin/builds/${selected.id}/files?path=${encodeURIComponent(path)}`);
      await loadAll();
      notify("Fichier retiré du build.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const channel = channels.find((entry) => entry.slug === selected?.channel);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Builds & versions</h1>
          <p>
            Préparez, testez et publiez les fichiers de chaque version. La publication est immédiatement détectée par les
            launchers joueurs.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="tabs">
            {(["all", "v1", "v2", "v3"] as const).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "all" ? "Tous" : item.toUpperCase()}
              </button>
            ))}
          </div>
          {editable && (
            <button className="btn primary" onClick={() => setCreateOpen(true)}>
              + Nouveau build
            </button>
          )}
        </div>
      </div>

      <div className="page-split">
        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Builds ({visibleBuilds.length})</h3>
              <button className="btn small ghost" onClick={() => void loadAll()}>
                ↻
              </button>
            </div>
            <div className="build-list">
              {visibleBuilds.length === 0 && <div className="empty">Aucun build pour ce filtre.</div>}
              {visibleBuilds.map((build) => (
                <button
                  key={build.id}
                  className={`build-item ${build.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(build.id)}
                >
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="t">{build.label}</span>
                    <span className={`chip ${build.status}`}>{build.status}</span>
                  </div>
                  <div className="m">
                    <span className="mono">{build.channel.toUpperCase()}</span>
                    <span>· MC {build.minecraftVersion}</span>
                    <span>· {build.loader}</span>
                    <span>· {build.fileCount} fichiers</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Versions du serveur</h3>
            <div className="stack" style={{ gap: 8 }}>
              {channels.map((entry) => (
                <div key={entry.slug} className="row between" style={{ gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className={`dot ${entry.enabled && entry.status.online ? "online" : "offline"}`} />
                      <strong style={{ fontSize: 12.5 }}>{entry.name}</strong>
                    </div>
                    <div className="small muted mono" style={{ marginTop: 3 }}>
                      {entry.serverHost}:{entry.serverPort} · {entry.activeBuildLabel ?? "aucun build"}
                    </div>
                  </div>
                  {can("settings.manage") && (
                    <button className="btn small ghost" onClick={() => setChannelEdit(entry)}>
                      Configurer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          {!selected && <div className="card empty">Sélectionnez un build ou créez-en un nouveau.</div>}

          {selected && form && (
            <>
              <div className="card">
                <div className="row between" style={{ marginBottom: 14 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{selected.label}</h3>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {selected.channel.toUpperCase()} · {selected.fileCount} fichier(s) · {formatBytes(selected.totalSize)} ·
                      créé le {new Date(selected.createdAt).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className={`chip ${selected.status}`}>{selected.status}</span>
                    {channel?.activeBuildId === selected.id && <span className="chip published">actif</span>}
                  </div>
                </div>

                <div className="stack" style={{ gap: 12 }}>
                  <div className="field">
                    <label>Nom du build</label>
                    <input
                      className="input"
                      value={form.label}
                      onChange={(event) => patch("label", event.target.value)}
                      disabled={!editable || selected.status === "published"}
                    />
                  </div>
                  <div className="field">
                    <label>Description (visible dans le launcher)</label>
                    <textarea
                      className="textarea"
                      value={form.description}
                      onChange={(event) => patch("description", event.target.value)}
                      disabled={!editable || selected.status === "published"}
                    />
                  </div>
                  <div className="field">
                    <label>Journal des modifications</label>
                    <textarea
                      className="textarea"
                      value={form.changelog}
                      onChange={(event) => patch("changelog", event.target.value)}
                      disabled={!editable || selected.status === "published"}
                      placeholder="• Ajout du mod…&#10;• Mise à jour de la configuration…"
                    />
                  </div>

                  <div className="field-row three">
                    <div className="field">
                      <label>Version Minecraft</label>
                      <input
                        className="input"
                        value={form.minecraftVersion}
                        onChange={(event) => patch("minecraftVersion", event.target.value)}
                        disabled={!editable || selected.status === "published"}
                        placeholder="1.20.1"
                      />
                    </div>
                    <div className="field">
                      <label>Loader</label>
                      <select
                        className="select"
                        value={form.loader}
                        onChange={(event) => patch("loader", event.target.value as LoaderType)}
                        disabled={!editable || selected.status === "published"}
                      >
                        {LOADERS.map((loader) => (
                          <option key={loader.value} value={loader.value}>
                            {loader.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Version du loader</label>
                      <input
                        className="input"
                        value={form.loaderVersion}
                        onChange={(event) => patch("loaderVersion", event.target.value)}
                        disabled={!editable || selected.status === "published" || form.loader === "vanilla"}
                        placeholder={form.loader === "fabric" ? "0.15.11" : "—"}
                      />
                    </div>
                  </div>

                  {(form.loader === "forge" || form.loader === "neoforge") && (
                    <div className="field">
                      <label>URL du profil de version {form.loader} (JSON)</label>
                      <input
                        className="input"
                        value={form.loaderProfileUrl}
                        onChange={(event) => patch("loaderProfileUrl", event.target.value)}
                        placeholder="https://cdn.assetown.fr/builds/forge-profile.json"
                        disabled={!editable || selected.status === "published"}
                      />
                      <span className="help">
                        Forge/NeoForge nécessitent le JSON de version généré par leur installateur (hébergé en HTTPS).
                      </span>
                    </div>
                  )}

                  <div className="field-row three">
                    <div className="field">
                      <label>RAM min (Mo)</label>
                      <input
                        className="input"
                        type="number"
                        value={form.javaMinRam}
                        onChange={(event) => patch("javaMinRam", Number(event.target.value))}
                        disabled={!editable || selected.status === "published"}
                      />
                    </div>
                    <div className="field">
                      <label>RAM max (Mo)</label>
                      <input
                        className="input"
                        type="number"
                        value={form.javaMaxRam}
                        onChange={(event) => patch("javaMaxRam", Number(event.target.value))}
                        disabled={!editable || selected.status === "published"}
                      />
                    </div>
                    <div className="field">
                      <label>Obligatoire</label>
                      <label className="switch" style={{ marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={form.required}
                          onChange={(event) => patch("required", event.target.checked)}
                          disabled={!editable || selected.status === "published"}
                        />
                        <span className="track" />
                        <span className="label">Build requis</span>
                      </label>
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label>Arguments JVM (un par ligne)</label>
                      <textarea
                        className="textarea"
                        style={{ minHeight: 66 }}
                        value={form.jvmArgs}
                        onChange={(event) => patch("jvmArgs", event.target.value)}
                        disabled={!editable || selected.status === "published"}
                      />
                    </div>
                    <div className="field">
                      <label>Arguments de jeu (un par ligne)</label>
                      <textarea
                        className="textarea"
                        style={{ minHeight: 66 }}
                        value={form.gameArgs}
                        onChange={(event) => patch("gameArgs", event.target.value)}
                        disabled={!editable || selected.status === "published"}
                      />
                    </div>
                  </div>

                  {selected.status === "published" && (
                    <div className="alert info">
                      Ce build est publié et verrouillé. Créez un nouveau build pour préparer la suite : l'ancien sera
                      archivé automatiquement.
                    </div>
                  )}

                  {issues.length > 0 && (
                    <div className="stack" style={{ gap: 6 }}>
                      {issues.map((issue, index) => (
                        <div key={index} className={`alert ${issue.severity === "error" ? "error" : "warn"}`}>
                          {issue.severity === "error" ? "✖" : "▲"} {issue.message}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="row wrap" style={{ gap: 8 }}>
                    {editable && selected.status !== "published" && (
                      <button className="btn" onClick={() => void saveBuild()} disabled={busy}>
                        Enregistrer
                      </button>
                    )}
                    {editable && selected.status !== "published" && (
                      <button className="btn" onClick={() => void testBuild()} disabled={busy}>
                        {busy && <span className="spinner" />} Tester
                      </button>
                    )}
                    {canPublish && (
                      <button
                        className="btn primary"
                        onClick={() => {
                          setPublishChangelog(form.changelog);
                          setPublishOpen(true);
                        }}
                        disabled={busy || selected.status === "published"}
                      >
                        Publier le build
                      </button>
                    )}
                    {canPublish && selected.status === "archived" && (
                      <button className="btn success" onClick={() => void rollback()} disabled={busy}>
                        Réactiver
                      </button>
                    )}
                    {editable && selected.status !== "published" && (
                      <button className="btn danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
                        Supprimer
                      </button>
                    )}
                  </div>
                  {selected.status !== "tested" && selected.status !== "published" && (
                    <span className="help">
                      La publication exige un test réussi. Cliquez sur « Tester » après vos modifications.
                    </span>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 style={{ margin: 0 }}>Fichiers ({selected.files.length})</h3>
                  {editable && selected.status !== "published" && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn small" onClick={() => void uploadFiles("mod")} disabled={busy}>
                        + Mods (.jar)
                      </button>
                      <button className="btn small" onClick={() => void uploadFiles("config")} disabled={busy}>
                        + Configs
                      </button>
                    </div>
                  )}
                </div>

                <div className="stack" style={{ gap: 6 }}>
                  {selected.files.length === 0 && (
                    <div className="empty">
                      Aucun fichier. Un build vanilla sans mods peut être publié, mais ajoutez au minimum vos configurations.
                    </div>
                  )}
                  {selected.files.map((file) => (
                    <div className="file-row" key={file.path}>
                      <span className={`chip ${file.kind === "mod" ? "tested" : ""}`} style={{ fontSize: 9.5 }}>
                        {file.kind}
                      </span>
                      <span className="path" title={file.path}>
                        {file.path}
                      </span>
                      <span className="mono small muted">{formatBytes(file.size)}</span>
                      <span className="mono small muted" title={file.sha256}>
                        {file.sha256.slice(0, 8)}
                      </span>
                      {editable && selected.status !== "published" && (
                        <button className="btn small ghost" onClick={() => void removeFile(file.path)}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {editable && selected.status !== "published" && (
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <input
                      className="input"
                      placeholder="Chemin personnalisé — ex: config/fancymenu/options.txt"
                      value={customPath}
                      onChange={(event) => setCustomPath(event.target.value)}
                    />
                    <button className="btn small" onClick={() => void uploadCustom()} disabled={busy}>
                      Envoyer
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={createOpen}
        title="Nouveau build"
        onClose={() => setCreateOpen(false)}
        actions={
          <>
            <button className="btn ghost" onClick={() => setCreateOpen(false)}>
              Annuler
            </button>
            <button className="btn primary" onClick={() => void createBuild()} disabled={busy || !newBuild.minecraftVersion}>
              Créer le brouillon
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Version</label>
            <select
              className="select"
              value={newBuild.channel}
              onChange={(event) => setNewBuild((current) => ({ ...current, channel: event.target.value as ChannelSlug }))}
            >
              {channels.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nom du build</label>
            <input
              className="input"
              value={newBuild.label}
              onChange={(event) => setNewBuild((current) => ({ ...current, label: event.target.value }))}
              placeholder="Assetown V2 — Season 4"
            />
          </div>
        </div>
        <div className="field-row three">
          <div className="field">
            <label>Version Minecraft</label>
            <input
              className="input"
              value={newBuild.minecraftVersion}
              onChange={(event) => setNewBuild((current) => ({ ...current, minecraftVersion: event.target.value }))}
            />
          </div>
          <div className="field">
            <label>Loader</label>
            <select
              className="select"
              value={newBuild.loader}
              onChange={(event) => setNewBuild((current) => ({ ...current, loader: event.target.value as LoaderType }))}
            >
              {LOADERS.map((loader) => (
                <option key={loader.value} value={loader.value}>
                  {loader.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Version du loader</label>
            <input
              className="input"
              value={newBuild.loaderVersion}
              onChange={(event) => setNewBuild((current) => ({ ...current, loaderVersion: event.target.value }))}
              disabled={newBuild.loader === "vanilla"}
            />
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            className="textarea"
            value={newBuild.description}
            onChange={(event) => setNewBuild((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={publishOpen}
        title="Publier le build"
        onClose={() => setPublishOpen(false)}
        actions={
          <>
            <button className="btn ghost" onClick={() => setPublishOpen(false)}>
              Annuler
            </button>
            <button className="btn primary" onClick={() => void publish()} disabled={busy}>
              Confirmer la publication
            </button>
          </>
        }
      >
        <p>
          Tous les joueurs de la version <strong>{selected?.channel.toUpperCase()}</strong> recevront ce build au prochain
          lancement. Le build actuellement publié sera archivé (réactivation possible).
        </p>
        <div className="alert warn">
          {selected?.status === "tested"
            ? "Build testé avec succès. La publication est immédiate et versionnée."
            : "Ce build n'a pas encore passé le test : la publication sera refusée. Lancez d'abord « Tester »."}
        </div>
        <div className="field">
          <label>Journal des modifications (visible par les joueurs)</label>
          <textarea
            className="textarea"
            value={publishChangelog}
            onChange={(event) => setPublishChangelog(event.target.value)}
          />
        </div>
      </Modal>

      <ConfirmModal
        open={deleteOpen}
        title="Supprimer ce build"
        message="Le build et ses fichiers seront définitivement supprimés. Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        onConfirm={() => void removeBuild()}
        onClose={() => setDeleteOpen(false)}
      />

      <ChannelModal
        channel={channelEdit}
        onClose={() => setChannelEdit(null)}
        onSaved={async () => {
          setChannelEdit(null);
          await loadAll();
        }}
        notify={notify}
      />
    </div>
  );
}

function ChannelModal({
  channel,
  onClose,
  onSaved,
  notify,
}: {
  channel: ChannelRow | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [form, setForm] = useState<ChannelRow | null>(channel);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(channel);
  }, [channel]);

  if (!channel || !form) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/admin/channels/${form.slug}`, {
        name: form.name,
        description: form.description,
        accent: form.accent,
        enabled: form.enabled,
        serverHost: form.serverHost,
        serverPort: form.serverPort,
        discordUrl: form.discordUrl,
      });
      notify("Version mise à jour.", "success");
      await onSaved();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Configurer ${form.name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="field">
        <label>Nom affiché</label>
        <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea
          className="textarea"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </div>
      <div className="field-row three">
        <div className="field">
          <label>Hôte Minecraft</label>
          <input
            className="input"
            value={form.serverHost}
            onChange={(event) => setForm({ ...form, serverHost: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Port</label>
          <input
            className="input"
            type="number"
            value={form.serverPort}
            onChange={(event) => setForm({ ...form, serverPort: Number(event.target.value) })}
          />
        </div>
        <div className="field">
          <label>Couleur (#rrggbb)</label>
          <input
            className="input"
            value={form.accent}
            onChange={(event) => setForm({ ...form, accent: event.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Discord de la version (optionnel)</label>
        <input
          className="input"
          value={form.discordUrl ?? ""}
          onChange={(event) => setForm({ ...form, discordUrl: event.target.value || null })}
        />
      </div>
      <label className="switch">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
        <span className="track" />
        <span className="label">Version accessible dans le launcher</span>
      </label>
      <div className="alert info small">
        Build actif : {form.activeBuildLabel ?? "aucun"} {form.activeBuildMinecraft ? `· MC ${form.activeBuildMinecraft}` : ""}
      </div>
    </Modal>
  );
}
