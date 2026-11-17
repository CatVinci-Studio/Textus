import { useEffect, useState } from "react";
import { dataUrl, readPluginFile, type PluginOrigin } from "../store/files";
import { PluginsTabIcon } from "../../engine/controls/icons";

/** A sidebar tab's icon: the plugin's SVG, drawn in the text colour. */
export function PluginTabIcon({
  plugin,
  origin,
  icon,
}: {
  plugin: string;
  origin: PluginOrigin;
  icon?: string;
}) {
  // null while it loads; "" when there is none to load.
  const [url, setUrl] = useState<string | null>(icon ? null : "");
  useEffect(() => {
    if (!icon) return;
    let live = true;
    readPluginFile(plugin, origin, icon)
      .then((bytes) => live && setUrl(dataUrl(icon, bytes)))
      .catch(() => live && setUrl(""));
    return () => {
      live = false;
    };
  }, [plugin, origin, icon]);
  // Without its own picture (none given, or unreadable): the plugins' own
  // icon, never an empty filled box.
  if (url === "") return <PluginsTabIcon />;
  return (
    <span
      className="plugin-tab-icon"
      aria-hidden="true"
      style={
        url
          ? { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }
          : { visibility: "hidden" }
      }
    />
  );
}
