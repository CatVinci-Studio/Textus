import {
  clearPluginColors,
  currentColors,
  setPluginColors,
  type Scheme,
} from "../../theme/plugin-colors";
import { str, type Params, type PluginScope } from "./broker-scope";

const SCHEMES = new Set(["light", "dark", "both"]);

/** A plugin's colours over the theme (theme/plugin-colors.ts): set and
 *  cleared with `appearance`; read by anyone, as plugin pages see them. */
export function appearanceHandlers(p: PluginScope) {
  return {
    "appearance.setColors": ({ colors, scheme }: Params) => {
      const which = scheme ?? "both";
      if (typeof which !== "string" || !SCHEMES.has(which))
        throw new Error(`scheme is "light", "dark" or "both".`);
      return setPluginColors(p.id, colors, which as Scheme | "both");
    },
    "appearance.clear": ({ id }: Params) =>
      clearPluginColors(p.id, str(id, "id")),
    "appearance.colors": () => currentColors(),
  };
}
