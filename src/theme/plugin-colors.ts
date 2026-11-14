import { onAppearance } from "../engine/tokens/appearance";
import { CUSTOM_CSS_STYLE_ID, PLUGIN_COLORS_STYLE_ID } from "./style-ids";
import {
  chromePalette,
  contrast,
  readable,
  type RGB,
} from "../engine/tokens/palette";
import {
  OPEN_COLORS,
  PAINT,
  checkColors,
  gradientStops,
  rgbOf,
  type Colors,
  type OpenColor,
} from "./plugin-colors-check";

/**
 * Plugins' colours, layered over whichever theme is on (plugin API
 * `textus.appearance`). Each layer gives light and dark values apart; per
 * variable the plugin last by id wins. What is applied keeps text readable
 * (4.5:1, pulled toward ink or white when it isn't) and, when the
 * interface's colours change, the interface's derived colours with them,
 * so an imported theme's fixed ones don't stay behind. Applied after the
 * theme and before the user's Custom CSS, which keeps the last word.
 */

export type Scheme = "light" | "dark";
interface Layer {
  plugin: string;
  light: Colors;
  dark: Colors;
}

const layers = new Map<string, Layer>();
let made = 0;
let written = "";
let stopWatch: (() => void) | null = null;

/** A probe in the page, which resolves a variable to the colour it is. */
function resolved(name: OpenColor): RGB | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.hidden = true;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return rgbOf(color);
}

const isDark = () =>
  getComputedStyle(document.documentElement).colorScheme === "dark";

/** The layers' colours for one scheme, plugins in id order. */
function composed(scheme: Scheme): Colors {
  const ordered = [...layers.values()].sort((a, b) =>
    a.plugin.localeCompare(b.plugin),
  );
  return Object.assign({}, ...ordered.map((layer) => layer[scheme]));
}

const rgb = (c: RGB) => `rgb(${c.map(Math.round).join(", ")})`;

/** Text kept readable on its background(s), from the layer or the theme. */
function pulled(
  colors: Colors,
  text: OpenColor,
  on: OpenColor,
  extra: RGB[] = [],
): RGB | null {
  const ink = rgbOf(colors[text] ?? "") ?? resolved(text);
  const paper = rgbOf(colors[on] ?? "") ?? resolved(on);
  if (!ink || !paper) return null;
  let out = ink;
  for (const background of [paper, ...extra])
    if (contrast(out, background) < 4.5) out = readable(out, background);
  return out;
}

/** What is set on the window: the layers' colours, text pulled readable,
 *  and the interface's derived colours when its own changed. */
function applied(colors: Colors): Record<string, string> {
  const out: Record<string, string> = { ...colors };
  if (!Object.keys(colors).length) return out;
  const docText = pulled(colors, "--doc-text", "--doc-bg");
  if (docText && (colors["--doc-text"] || colors["--doc-bg"]))
    out["--doc-text"] = rgb(docText);
  const muted = pulled(colors, "--doc-muted", "--doc-bg");
  if (muted && (colors["--doc-muted"] || colors["--doc-bg"]))
    out["--doc-muted"] = rgb(muted);
  const paint = colors[PAINT];
  const stops = paint ? gradientStops(paint) : [];
  const ui = ["--ui-bg", "--ui-text", "--ui-accent"] as const;
  if (ui.some((name) => colors[name]) || stops.length) {
    for (const name of ui) if (colors[name]) out[name] = colors[name];
    const background = rgbOf(colors["--ui-bg"] ?? "") ?? resolved("--ui-bg");
    const text = pulled(colors, "--ui-text", "--ui-bg", stops);
    const accent =
      rgbOf(colors["--ui-accent"] ?? "") ?? resolved("--ui-accent");
    if (background && text && accent) {
      const derived = chromePalette(background, text, accent);
      for (const [name, value] of Object.entries(derived))
        if (
          name.startsWith("--ui-") &&
          !(ui as readonly string[]).includes(name)
        )
          out[name] = value;
      // Pulled readable on the paint too, past what the palette checks.
      out["--ui-text"] = rgb(text);
    }
  }
  return out;
}

/** The rule as the browser writes it, values set through the CSSOM one
 *  by one, never pieced together as text. */
function ruleText(values: Record<string, string>): string {
  const sheet = new CSSStyleSheet();
  sheet.insertRule(":root {}");
  const rule = sheet.cssRules[0] as CSSStyleRule;
  for (const [name, value] of Object.entries(values))
    rule.style.setProperty(name, value, "important");
  return rule.cssText;
}

/** Last in <head> but for the user's Custom CSS, which keeps the last
 *  word; apply-appearance.ts keeps that order when it puts a theme back. */
function place(style: HTMLStyleElement): void {
  const custom = document.getElementById(CUSTOM_CSS_STYLE_ID);
  if (custom) document.head.insertBefore(style, custom);
  else document.head.appendChild(style);
}

function apply(): void {
  // Read as the theme alone has them: what the layers pinned last time
  // would otherwise outlive a change of theme.
  const sheet = (
    document.getElementById(PLUGIN_COLORS_STYLE_ID) as HTMLStyleElement | null
  )?.sheet;
  if (sheet) sheet.disabled = true;
  let values: Record<string, string>;
  try {
    values = applied(composed(isDark() ? "dark" : "light"));
  } finally {
    if (sheet) sheet.disabled = false;
  }
  const key = JSON.stringify(values);
  if (key === written) return;
  written = key;
  if (!Object.keys(values).length) {
    document.getElementById(PLUGIN_COLORS_STYLE_ID)?.remove();
    return;
  }
  const style =
    (document.getElementById(
      PLUGIN_COLORS_STYLE_ID,
    ) as HTMLStyleElement | null) ??
    Object.assign(document.createElement("style"), {
      id: PLUGIN_COLORS_STYLE_ID,
    });
  style.textContent = ruleText(values);
  place(style);
}

function changed(): void {
  if (layers.size && !stopWatch) stopWatch = onAppearance(apply);
  if (!layers.size && stopWatch) {
    stopWatch();
    stopWatch = null;
  }
  written = "";
  apply();
}

/** Layers a plugin's colours over the theme, for one scheme or both;
 *  returns the layer's id. Throws when a name or value isn't taken. */
export function setPluginColors(
  plugin: string,
  vars: unknown,
  scheme: Scheme | "both" = "both",
): string {
  const colors = checkColors(vars);
  const id = `${plugin}#${++made}`;
  layers.set(id, {
    plugin,
    light: scheme === "dark" ? {} : colors,
    dark: scheme === "light" ? {} : colors,
  });
  changed();
  return id;
}

/** Takes one of a plugin's layers away. */
export function clearPluginColors(plugin: string, id: string): void {
  if (layers.get(id)?.plugin !== plugin) return;
  layers.delete(id);
  changed();
}

/** Takes all of a plugin's layers away: it stopped. */
export function forgetPluginColors(plugin: string): void {
  let any = false;
  for (const [id, layer] of layers)
    if (layer.plugin === plugin) any = layers.delete(id);
  if (any) changed();
}

/** Which theme and scheme are showing, and what the layers set: what a
 *  plugin is told changed (its `appearance` event) when any of it does. */
export function appearanceNow(): {
  theme: string;
  scheme: Scheme;
  key: string;
} {
  const theme = document.documentElement.dataset.themeId ?? "default";
  const scheme = isDark() ? "dark" : "light";
  return { theme, scheme, key: `${theme} ${scheme} ${written}` };
}

/** The open colours as the window shows them now (theme and layers). */
export function currentColors(): Record<OpenColor, string> {
  const out = {} as Record<OpenColor, string>;
  for (const name of OPEN_COLORS) {
    if (name === PAINT) {
      out[name] = getComputedStyle(document.documentElement)
        .getPropertyValue(PAINT)
        .trim();
      continue;
    }
    const value = resolved(name);
    out[name] = value ? rgb(value) : "";
  }
  return out;
}
