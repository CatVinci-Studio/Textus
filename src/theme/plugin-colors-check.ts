import type { RGB } from "../engine/tokens/palette";

/**
 * The colours a plugin may set (plugin API `textus.appearance`): only the
 * ones the others are drawn from, so whatever it picks the design keeps its
 * proportions. Each value is read back through the webview's own CSS parser
 * and must come out a colour, or for the frame's paint a gradient of them.
 */

export const OPEN_COLORS = [
  "--doc-bg",
  "--doc-text",
  "--doc-muted",
  "--doc-accent",
  "--doc-mark",
  "--doc-code-bg",
  "--ui-bg",
  "--ui-text",
  "--ui-accent",
  "--ui-frame-tint",
  "--ui-frame-paint",
  "--tone-blue",
  "--tone-green",
  "--tone-orange",
  "--tone-purple",
  "--tone-red",
  "--tone-teal",
  "--tone-yellow",
  "--tone-pink",
  "--tone-gray",
] as const;

export type OpenColor = (typeof OPEN_COLORS)[number];
export type Colors = Partial<Record<OpenColor, string>>;

export const PAINT: OpenColor = "--ui-frame-paint";
const MAX_LENGTH = 600;
const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
// Nothing that fetches, refers elsewhere or escapes: a value is colours,
// angles, lengths and the gradient functions, nothing else.
const FORBIDDEN =
  /[\\@;{}<>!]|\b(url|var|env|attr|image|image-set|element|cross-fade|paint|src)\s*\(/i;

// Not a colour of its own: taken from somewhere else.
const KEYWORDS =
  /^(inherit|initial|unset|revert|revert-layer|currentcolor|none)$/i;

const isOpen = (name: string): name is OpenColor =>
  (OPEN_COLORS as readonly string[]).includes(name);

/** The value as the parser writes it back, or null when it isn't one. */
function parsed(property: "color" | "background-image", value: string) {
  const probe = document.createElement("div").style;
  probe.setProperty(property, value);
  const out = probe.getPropertyValue(property);
  return out && !FORBIDDEN.test(out) && !KEYWORDS.test(out) ? out : null;
}

function checkValue(name: OpenColor, value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name}: a colour is a non-empty string.`);
  if (value.length > MAX_LENGTH || FORBIDDEN.test(value))
    throw new Error(`${name}: only colours are taken.`);
  const gradient = name === PAINT && GRADIENT.test(value.trim());
  const out = gradient
    ? parsed("background-image", value)
    : parsed("color", value);
  if (!out || (gradient && !GRADIENT.test(out)))
    throw new Error(
      `${name}: "${value.slice(0, 80)}" is not a colour${name === PAINT ? " or gradient" : ""}.`,
    );
  return out;
}

/** A plugin's colours checked: each name one of OPEN_COLORS, each value a
 *  colour (or the paint's gradient). Throws, naming the first bad one. */
export function checkColors(vars: unknown): Colors {
  if (!vars || typeof vars !== "object" || Array.isArray(vars))
    throw new Error("Colours are an object of variable: value.");
  const out: Colors = {};
  for (const [name, value] of Object.entries(vars)) {
    if (!isOpen(name))
      throw new Error(`${name} is not a colour plugins can set.`);
    out[name] = checkValue(name, value);
  }
  return out;
}

let canvas: CanvasRenderingContext2D | null | undefined;

const SRGB =
  /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+%?))?\)$/;
const SENTINEL = "#010203";

/** A colour as its RGB, or null when it isn't opaque (or can't be read).
 *  A mix computes to color(srgb ...), which a canvas may not take. */
export function rgbOf(value: string): RGB | null {
  const srgb = SRGB.exec(value.trim());
  if (srgb) {
    const alpha = srgb[4]
      ? parseFloat(srgb[4]) / (srgb[4].endsWith("%") ? 100 : 1)
      : 1;
    if (alpha < 1) return null;
    const at = (i: number) =>
      Math.round(Math.min(1, Math.max(0, Number(srgb[i]))) * 255);
    return [at(1), at(2), at(3)];
  }
  if (canvas === undefined)
    canvas = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
  if (!canvas) return null;
  canvas.fillStyle = SENTINEL;
  canvas.fillStyle = value;
  // Not taken: the canvas kept what it had.
  if (canvas.fillStyle === SENTINEL && value.toLowerCase() !== SENTINEL)
    return null;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
  return a === 255 ? [r, g, b] : null;
}

/** A gradient's colour stops, as RGB: what text on it must read against. */
export function gradientStops(paint: string): RGB[] {
  const inner = paint.slice(paint.indexOf("(") + 1, paint.lastIndexOf(")"));
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) {
      parts.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(inner.slice(from));
  return parts.flatMap((part) => {
    // A stop is a colour with up to two positions after it.
    const colour = part
      .trim()
      .replace(/(\s+-?[\d.]+(%|[a-z]+)?){1,2}$/i, "")
      .trim();
    // The direction or shape before the stops is no colour.
    const rgb = parsed("color", colour) && rgbOf(colour);
    return rgb ? [rgb] : [];
  });
}
