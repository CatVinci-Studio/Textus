import { useRef } from "react";
import { useContentMin } from "../../engine/frame/content-min";
import type { Strings } from "../../i18n/strings";
import { PluginDetail } from "./PluginDetail";
import "./plugin-tab.css";

/**
 * A plugin's tab: its page - README, version, permissions, its settings,
 * data - opened from the sidebar's list of plugins. One such tab in a
 * window, showing the plugin last opened.
 */
export function PluginTab({ t, id }: { t: Strings; id: string | null }) {
  // Its narrowest line, for its island to keep (content-min.ts).
  const root = useRef<HTMLDivElement>(null);
  useContentMin(root, ".plugin-page");
  return (
    <div ref={root} className="plugin-tab tx-scroll-reveal">
      {id && <PluginDetail id={id} t={t} />}
    </div>
  );
}
