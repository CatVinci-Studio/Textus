import { useEffect, useState, useSyncExternalStore } from "react";
import { requestCreate } from "../../ai/chat/create-request";
import { isDesktopApp } from "../../platform/capabilities";
import { plugins as pluginsIpc } from "../../platform/ipc";
import {
  pluginsSnapshot,
  setAllPlugins,
  subscribePlugins,
} from "../../plugins/manager";
import type { Strings } from "../../i18n/strings";
import { ToggleRow } from "../sections/controls";
import { usePluginActions } from "./PluginAction";
import { PluginDetail } from "./PluginDetail";
import { PluginsPanel } from "./PluginsPanel";
import { installPluginFiles } from "./PluginsPage";
import "./plugins-tab.css";

/**
 * The Plugins tab: the list - installed and the catalog's, one search over
 * both - and beside it the picked plugin's page (version, permissions, its
 * settings, data); with none picked, the switch for plugin features and
 * the ways to add one. `to` picks one (a request from a menu).
 */
export function PluginsTab({ t, to }: { t: Strings; to?: string | null }) {
  const [picked, setPicked] = useState<string | null>(to ?? null);
  useEffect(() => {
    if (to) setPicked(to);
  }, [to]);
  return (
    <div className="plugins-tab">
      <div className="plugins-tab-list">
        <PluginsPanel t={t} picked={picked} onPick={setPicked} />
      </div>
      <div className="plugins-tab-page">
        {picked ? (
          <PluginDetail id={picked} t={t} onBack={() => setPicked(null)} />
        ) : (
          <PluginsOverview t={t} onOpen={setPicked} />
        )}
      </div>
    </div>
  );
}

/** With no plugin picked: plugin features on or off, and the ways to add
 *  one - a package, a folder being made, or Create. */
function PluginsOverview({
  t,
  onOpen,
}: {
  t: Strings;
  onOpen: (id: string) => void;
}) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const { attempt } = usePluginActions(t);
  const add = (folder: boolean) =>
    attempt(async () => {
      const opened = await installPluginFiles(t, folder);
      if (opened) onOpen(opened);
    });
  return (
    <div className="plugins-tab-overview">
      <h1 className="settings-category-title">{t.extensionsTabPlugins}</h1>
      <p className="plugins-tab-intro">{t.extensionsIntroPlugins}</p>
      <ToggleRow
        label={t.pluginsAllLabel}
        help={t.pluginsAllHelp}
        checked={snapshot.allOn}
        onChange={(on) => void attempt(() => setAllPlugins(on))}
      />
      <div className="plugins-tab-actions">
        <button
          type="button"
          className="tx-button primary"
          onClick={() => requestCreate("", "plugin")}
        >
          {t.createMakePlugin}
        </button>
        {isDesktopApp && (
          <>
            <button
              type="button"
              className="tx-button"
              onClick={() => void add(false)}
            >
              {t.pluginsInstallFile}
            </button>
            <button
              type="button"
              className="tx-button"
              onClick={() => void add(true)}
            >
              {t.pluginsLoadFolder}
            </button>
            <button
              type="button"
              className="tx-button"
              onClick={() => void attempt(() => pluginsIpc.openScriptsDir())}
            >
              {t.pluginsOpenScripts}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
