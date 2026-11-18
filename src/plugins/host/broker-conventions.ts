import {
  addConventionReader,
  removeConventionReader,
} from "../contributions/convention-readers";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** `textus.files.registerConventionReader`: another app's folder
 *  conventions, read by the plugin from the marker file the core finds. */
export function conventionReaderHandlers(p: PluginScope) {
  return {
    "files.registerConventionReader": ({
      id,
      label,
      marker,
      notes,
    }: Params) => {
      const own = str(id, "id");
      addConventionReader(`${p.id}#${own}`, optionalStr(label) ?? own, {
        plugin: p.id,
        marker: str(marker, "marker"),
        notes: notes === true,
        read: (root, text) =>
          p.request("$conventionRead", { id: own, root, text }),
      });
    },
    "files.unregisterConventionReader": ({ id }: Params) => {
      removeConventionReader(`${p.id}#${str(id, "id")}`);
    },
  };
}
