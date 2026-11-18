import { isDrivePath } from "../../utils/path";

/**
 * Attribute values raw HTML may keep: alignment, sizes, links and picture
 * sources that load nothing unsafe, and the few style properties a document
 * draws with.
 */

// `align` is read where HTML (and GitHub) honour it.
export const ALIGN_TAGS = new Set([
  "p",
  "div",
  "center",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

const ALIGN_VALUES = new Set(["left", "center", "right", "justify"]);
export function sanitizeAlign(value: string): string | null {
  const lower = value.trim().toLowerCase();
  return ALIGN_VALUES.has(lower) ? lower : null;
}

export function sanitizeDimension(value: string): string | null {
  return /^\d{1,5}(%|px)?$/.test(value.trim()) ? value.trim() : null;
}

export function sanitizeSpan(value: string): string | null {
  const n = /^\d{1,4}$/.test(value.trim()) ? Number(value) : NaN;
  return n >= 1 && n <= 1000 ? String(n) : null;
}

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
/** Rejects javascript:/data:/file: etc.; relative URLs resolve against the
 *  dummy base as "http:" and pass. */
export function sanitizeUrl(value: string): string | null {
  try {
    const resolved = new URL(value, "http://localhost/");
    return ALLOWED_URL_PROTOCOLS.has(resolved.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** An image may also be a raster data URL or a Windows path. Not
 *  image/svg+xml: an SVG only ever comes from svgToImage, cleaned. */
export function sanitizeImageSrc(value: string): string | null {
  const trimmed = value.trim();
  if (
    /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[\w+/=\s]*$/i.test(
      trimmed,
    )
  )
    return trimmed;
  if (isDrivePath(trimmed)) return trimmed;
  return sanitizeUrl(value);
}

// --- style ---------------------------------------------------------------

// Hex, plain-number rgb()/hsl(), or a keyword: letters alone can't load or
// compute anything.
const COLOR_RE =
  /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgba?|hsla?)\(\s*[-\d.%deg\s,/]+\)|[a-z]{3,20})$/;
const SIZE_RE = /^\d{1,4}(\.\d{1,3})?(px|em|rem|%)$/;
const DECORATION_LINES = new Set([
  "none",
  "underline",
  "overline",
  "line-through",
]);

const STYLE_RULES: Record<string, (value: string) => boolean> = {
  color: (v) => COLOR_RE.test(v),
  "background-color": (v) => COLOR_RE.test(v),
  "font-size": (v) => SIZE_RE.test(v),
  "font-weight": (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v),
  "font-style": (v) => /^(normal|italic|oblique)$/.test(v),
  "text-align": (v) => /^(left|right|center|justify|start|end)$/.test(v),
  "text-decoration": (v) =>
    v.split(/\s+/).every((part) => DECORATION_LINES.has(part)),
  "text-decoration-line": (v) =>
    v.split(/\s+/).every((part) => DECORATION_LINES.has(part)),
};

/**
 * The safe part of a `style` attribute: allowed properties with literal
 * values. Anything else drops that declaration. Null when nothing is left.
 */
export function sanitizeStyle(value: string): string | null {
  const kept: string[] = [];
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const val = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const valid = STYLE_RULES[prop];
    if (valid && val && valid(val)) kept.push(`${prop}: ${val}`);
  }
  return kept.length > 0 ? kept.join("; ") : null;
}
