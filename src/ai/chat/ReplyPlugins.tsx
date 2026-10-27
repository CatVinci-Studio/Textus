import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pluginsInReply, type ReplyPlugin } from "../../plugins/chat-plugin";
import {
  installPlugin,
  pluginsSnapshot,
  setPluginEnabled,
  subscribePlugins,
} from "../../plugins/manager";
import { localize, type Permission } from "../../plugins/store/manifest";
import { openReadme } from "../../plugins/store/readme";
import { showMessage } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import { exportPluginForPublishing } from "../../plugins/store/plugin-export";

export interface ReplyPluginLabels {
  installPlugin: string;
  updatePlugin: string;
  pluginInstalled: string;
  usageGuide: string;
  exportPlugin: string;
  /** "Can't be installed: {reason}". */
  pluginCantInstall: string;
  /** What a permission lets a plugin do, in a few words. */
  permission: (permission: Permission) => string;
  language: string;
}

/**
 * Install this plugin, under a reply that wrote one. Its usage guide is a
 * click away, not opened: a new tab would take the conversation with it.
 */
export function ReplyPlugins({
  text,
  labels,
}: {
  text: string;
  labels: ReplyPluginLabels;
}) {
  const plugins = useMemo(() => pluginsInReply(text), [text]);
  if (plugins.length === 0) return null;
  return (
    <>
      {plugins.map((plugin, i) => (
        <ReplyPluginChip key={i} plugin={plugin} labels={labels} />
      ))}
    </>
  );
}

function ReplyPluginChip({
  plugin,
  labels,
}: {
  plugin: ReplyPlugin;
  labels: ReplyPluginLabels;
}) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const manifest = plugin.manifest;
  if (!manifest)
    return (
      <div className="agent-theme-chip agent-plugin-chip">
        <span className="settings-error">
          {labels.pluginCantInstall.replace("{reason}", plugin.error ?? "")}
        </span>
      </div>
    );
  const name = localize(manifest, manifest.name, labels.language);
  const installed = snapshot.records.find((r) => r.id === manifest.id);
  const current = installed?.manifest?.version === manifest.version;

  async function install() {
    if (working.current || !manifest) return;
    working.current = true;
    setBusy(true);
    try {
      const id = await installPlugin(plugin.files);
      await setPluginEnabled(id, true);
    } catch (err) {
      await showMessage(errorText(err), { tone: "error" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      className="agent-theme-chip agent-plugin-chip"
      data-plugin={manifest.id}
    >
      <span className="agent-theme-chip-name">{name}</span>
      {manifest.permissions.length > 0 && (
        <span className="agent-plugin-permissions">
          {manifest.permissions.map(labels.permission).join(" · ")}
        </span>
      )}
      <button
        type="button"
        disabled={busy || current}
        onClick={() => void install()}
      >
        {current
          ? labels.pluginInstalled
          : installed
            ? labels.updatePlugin
            : labels.installPlugin}
      </button>
      {current && (
        <button type="button" onClick={() => void openReadme(manifest.id)}>
          {labels.usageGuide}
        </button>
      )}
      {current && (
        <button
          type="button"
          onClick={() => void exportPluginForPublishing(manifest.id)}
        >
          {labels.exportPlugin}
        </button>
      )}
    </div>
  );
}
