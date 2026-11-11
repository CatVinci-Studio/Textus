import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pluginsInReply, type ReplyPlugin } from "./reply-plugin";
import {
  checkPlugin,
  type PluginCheck,
} from "../../plugins/store/plugin-check";
import {
  pluginLog,
  pluginLogVersion,
  subscribePluginLog,
} from "../../plugins/store/plugin-log";
import { askAi } from "./ask-ai";
import { pluginsSnapshot, subscribePlugins } from "../../plugins/manager";
import { installPlugin, setPluginEnabled } from "../../plugins/plugin-switches";
import { localize, type Permission } from "../../plugins/store/manifest";
import { openReadme } from "../../plugins/store/readme";
import { showMessage } from "../../engine/controls/app-dialog";
import { exportPluginForPublishing } from "../../plugins/store/plugin-export";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";
import { ReplyFilesPreview } from "./ReplyFilesPreview";
import { useSettings } from "../../prefs/SettingsContext";
import { useLatest } from "../../utils/hooks/useLatest";
import { withCreation } from "./creations";

export interface ReplyPluginLabels {
  installPlugin: string;
  updatePlugin: string;
  pluginInstalled: string;
  usageGuide: string;
  exportPlugin: string;
  /** Unfolds the files Install would install. */
  showCode: string;
  /** "{name} asks to:", over its permissions one to a line. */
  permissionsAsk: string;
  /** "Can't be installed: {reason}". */
  pluginCantInstall: string;
  /** What checkPlugin and the plugin's first run found, and asking the AI
   *  to fix it. */
  pluginCheck: {
    dom: string;
    /** "{permission}". */
    permission: string;
    /** "{id}". */
    unregistered: string;
    /** "{key}". */
    when: string;
    /** "{error}". */
    runError: string;
    fix: string;
    /** "{name}", "{problems}". */
    fixRequest: string;
  };
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
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  useSyncExternalStore(subscribePluginLog, pluginLogVersion);
  const [busy, setBusy] = useState(false);
  // When this card installed it: errors logged since are this version's.
  const [installedAt, setInstalledAt] = useState<number | null>(null);
  const working = useRef(false);
  const manifest = plugin.manifest;
  const checks = useMemo(
    () => (manifest ? checkPlugin(manifest, plugin.files) : []),
    [manifest, plugin.files],
  );
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
  const problems = checks.map((c) => checkText(c, labels));
  const runError =
    installedAt === null
      ? undefined
      : pluginLog(manifest.id)
          .filter((e) => e.level === "error" && e.at >= installedAt)
          .pop();
  if (runError)
    problems.push(
      labels.pluginCheck.runError.replace("{error}", runError.message),
    );

  async function install() {
    if (working.current || !manifest) return;
    working.current = true;
    setBusy(true);
    try {
      setInstalledAt(Date.now());
      const id = await installPlugin(plugin.files);
      await setPluginEnabled(id, true);
      setSettings({
        creations: withCreation(latest.current.creations, {
          kind: "plugin",
          id,
          name,
          at: Date.now(),
        }),
      });
    } catch (err) {
      await showMessage(explainError(err, currentStrings()), { tone: "error" });
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
      {manifest.permissions.length > 0 && (
        <div className="agent-plugin-permissions">
          {labels.permissionsAsk.replace("{name}", name)}
          <ul>
            {manifest.permissions.map((p) => (
              <li key={p}>{labels.permission(p)}</li>
            ))}
          </ul>
        </div>
      )}
      <ReplyFilesPreview label={labels.showCode} files={plugin.files} />
      {problems.length > 0 && (
        <div className="agent-plugin-problems" role="status">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              askAi(
                labels.pluginCheck.fixRequest
                  .replace("{name}", `${name} (${manifest.id})`)
                  .replace(
                    "{problems}",
                    problems.map((p) => `- ${p}`).join("\n"),
                  ),
                "create",
              )
            }
          >
            {labels.pluginCheck.fix}
          </button>
        </div>
      )}
    </div>
  );
}

function checkText(check: PluginCheck, labels: ReplyPluginLabels): string {
  const t = labels.pluginCheck;
  switch (check.kind) {
    case "dom":
      return t.dom;
    case "permission":
      return t.permission.replace(
        "{permission}",
        labels.permission(check.permission),
      );
    case "unregistered":
      return t.unregistered.replace("{id}", check.id);
    case "when":
      return t.when.replace("{key}", check.key);
  }
}
