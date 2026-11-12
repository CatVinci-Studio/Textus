import { useEffect, useState } from "react";
import { dataUrl, readPluginFile, type PluginOrigin } from "../store/files";

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
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!icon) return;
    let live = true;
    readPluginFile(plugin, origin, icon)
      .then((bytes) => live && setUrl(dataUrl(icon, bytes)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [plugin, origin, icon]);
  return (
    <span
      className="plugin-tab-icon"
      aria-hidden="true"
      style={
        url
          ? { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }
          : undefined
      }
    />
  );
}
