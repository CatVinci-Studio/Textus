import { useEffect, useState } from "react";
import { dataUrl, readPluginFile, type PluginOrigin } from "../store/files";
import { PluginsTabIcon } from "../../engine/controls/icons";

/** Icons decoded already, by plugin and file: drawn at once when shown
 *  again. */
const decodedIcons = new Map<string, string>();

/** `url` decoded before it is a mask: a mask whose picture isn't ready yet
 *  draws its whole box in the colour for a few frames. */
async function decoded(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode?.().catch(() => {});
  return url;
}

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
  const key = `${origin}\n${plugin}\n${icon}`;
  const [url, setUrl] = useState<string | null>(
    icon ? (decodedIcons.get(key) ?? null) : "",
  );
  useEffect(() => {
    if (!icon) return;
    const known = decodedIcons.get(key);
    if (known) return setUrl(known);
    let live = true;
    readPluginFile(plugin, origin, icon)
      .then((bytes) => decoded(dataUrl(icon, bytes)))
      .then((ready) => {
        decodedIcons.set(key, ready);
        if (live) setUrl(ready);
      })
      .catch(() => live && setUrl(""));
    return () => {
      live = false;
    };
  }, [plugin, origin, icon, key]);
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
