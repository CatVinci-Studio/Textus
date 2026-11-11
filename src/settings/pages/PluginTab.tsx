import type { Strings } from "../../i18n/strings";
import { PluginDetail } from "./PluginDetail";
import "./plugin-tab.css";

/**
 * A plugin's tab: its page - README, version, permissions, its settings,
 * data - opened from the sidebar's list of plugins. One such tab in a
 * window, showing the plugin last opened.
 */
export function PluginTab({ t, id }: { t: Strings; id: string | null }) {
  return (
    <div className="plugin-tab tx-scroll-reveal">
      {id && <PluginDetail id={id} t={t} />}
    </div>
  );
}
