// Watching the window must not load the palette renderer and its assets.
import { windowIsDark } from "../engine/tokens/appearance";
export type Scheme = "light" | "dark";
let colorsKey = "";
export function setAppearanceColorsKey(value: string): void {
  colorsKey = value;
}

/** Which theme and scheme are showing, and what the layers set: what a
 *  plugin is told changed (its `appearance` event) when any of it does. */
export function appearanceNow(): {
  theme: string;
  scheme: Scheme;
  key: string;
} {
  const theme = document.documentElement.dataset.themeId ?? "default";
  const scheme = windowIsDark() ? "dark" : "light";
  return { theme, scheme, key: `${theme} ${scheme} ${colorsKey}` };
}
