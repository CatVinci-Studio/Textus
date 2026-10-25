import { useSyncExternalStore } from "react";
import { SettingsGroup } from "./SettingsGroup";
import type { Strings } from "../../i18n/strings";
import {
  clearPluginLog,
  pluginLog,
  pluginLogVersion,
  subscribePluginLog,
} from "../../plugins/plugin-log";

/** What went wrong in the plugin lately (plugin-log.ts), newest first;
 *  nothing when nothing has. */
export function PluginErrors({ id, t }: { id: string; t: Strings }) {
  useSyncExternalStore(subscribePluginLog, pluginLogVersion);
  const entries = pluginLog(id);
  if (entries.length === 0) return null;
  const text = entries
    .map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.message}`)
    .join("\n");
  return (
    <SettingsGroup title={t.pluginErrorsGroup}>
      <pre className="plugin-errors" data-plugin-errors={id}>
        {[...entries]
          .reverse()
          .map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.message}`)
          .join("\n")}
      </pre>
      <div className="plugin-errors-actions">
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          {t.pluginErrorsCopy}
        </button>
        <button type="button" onClick={() => clearPluginLog(id)}>
          {t.pluginErrorsClear}
        </button>
      </div>
    </SettingsGroup>
  );
}
