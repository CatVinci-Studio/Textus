// Watching the window must not load the palette renderer and its assets.
export type Scheme = "light" | "dark";
let colorsKey = "";
export function setAppearanceColorsKey(value: string): void {
  colorsKey = value;
}
const isDark = () =>
  getComputedStyle(document.documentElement).colorScheme === "dark";

/** Which theme and scheme are showing, and what the layers set: what a
 *  plugin is told changed (its `appearance` event) when any of it does. */
export function appearanceNow(): {
  theme: string;
  scheme: Scheme;
  key: string;
} {
  const theme = document.documentElement.dataset.themeId ?? "default";
  const scheme = isDark() ? "dark" : "light";
  return { theme, scheme, key: `${theme} ${scheme} ${colorsKey}` };
}
