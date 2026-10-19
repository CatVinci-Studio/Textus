import { isDrivePath } from "../../utils/path";

/**
 * The one HTML policy for a document's own markup: what the WYSIWYG editor
 * renders of raw HTML (raw-html-sanitize.ts) and what the split view's
 * preview renders of the whole document (markdown/render-html.ts). Both
 * read the same whitelist, so a snippet looks the same in either view.
 *
 * Why so strict: the webview runs with no CSP and full Tauri IPC (file
 * read/write), so anything that executes in a document is as good as code
 * on the user's machine. Hence an allow-list rather than a deny-list:
 * - tags outside the list unwrap (their text stays), and the ones that ARE
 *   the attack surface (script, style, iframe, ...) drop with their content;
 * - attributes are allowed per tag and validated; no on*, no id/name;
 * - href/src take http, https, mailto or a relative path only;
 * - `style` keeps a few text properties with literal values - nothing that
 *   can load a resource (url(), image-set, @import) or compute one (var(),
 *   expression(), calc());
 * - an <svg> never enters the page as DOM: it becomes an <img> of an
 *   image/svg+xml data URL, where scripts, event handlers and
 *   foreignObject don't run and nothing external loads. It is also
 *   stripped of all of those first, for an exported page opened elsewhere.
 *
 * Elements are created in the parsed (inert) document, never the live one:
 * an <img> created in the page starts loading its src before it is even
 * attached.
 */

// Block-level: a fragment containing one of these renders as a block.
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "center",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "hr",
  "details",
  "summary",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);
// Inline-level: a fragment made only of these (plus text) renders inline,
// in the line it was written in.
export const INLINE_TAGS = new Set([
  "span",
  "img",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "a",
  "sub",
  "sup",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "kbd",
  "code",
  "small",
  "input",
]);
export const ALLOWED_TAGS = new Set([...BLOCK_TAGS, ...INLINE_TAGS, "svg"]);

// Dropped along with their children - the actual attack surface, distinct
// from "just not in the whitelist" (which unwraps instead, keeping content).
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "template",
  "noscript",
  "link",
  "meta",
  "base",
]);

// `align` is read where HTML (and GitHub) honour it.
const ALIGN_TAGS = new Set([
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
function sanitizeAlign(value: string): string | null {
  const lower = value.trim().toLowerCase();
  return ALIGN_VALUES.has(lower) ? lower : null;
}

export function sanitizeDimension(value: string): string | null {
  return /^\d{1,5}(%|px)?$/.test(value.trim()) ? value.trim() : null;
}

function sanitizeSpan(value: string): string | null {
  const n = /^\d{1,4}$/.test(value.trim()) ? Number(value) : NaN;
  return n >= 1 && n <= 1000 ? String(n) : null;
}

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
/** Rejects javascript:/data:/vbscript:/file:/etc.; relative and
 *  scheme-less URLs (the common case for local images and links) resolve
 *  against the dummy base and come out as "http:", so they pass through. */
export function sanitizeUrl(value: string): string | null {
  try {
    const resolved = new URL(value, "http://localhost/");
    return ALLOWED_URL_PROTOCOLS.has(resolved.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** An image may also be a raster data URL (a pasted screenshot) or a
 *  Windows path the image loader resolves (images/image-plugin.ts). Not
 *  image/svg+xml: an SVG only ever comes from svgToImage below, cleaned. */
function sanitizeImageSrc(value: string): string | null {
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

// Hex, rgb()/rgba()/hsl()/hsla() with plain numbers, or a keyword (a named
// colour, currentcolor, transparent): letters alone can't load or compute
// anything, so they need no list.
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
 * The safe part of a `style` attribute: allowed properties whose values
 * match a literal pattern, rebuilt as "prop: value; ...". Anything else -
 * another property, url(), var(), a comment, an escape, !important -
 * drops that declaration. Null when nothing is left.
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

// --- svg -----------------------------------------------------------------

const SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textpath",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "use",
  "marker",
  "title",
  "desc",
  "filter",
  "feblend",
  "fecolormatrix",
  "fecomposite",
  "feflood",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "feoffset",
  "fedropshadow",
]);
// Not in the list and also dropped: script, foreignObject (HTML inside an
// SVG), style (CSS that can @import), image (loads a file), animate/set
// (can rewrite an href to javascript: after load). <a> unwraps.
const SVG_UNWRAP = new Set(["a", "switch"]);

/** Within an SVG, a reference may only point inside the same picture. */
function safeSvgAttribute(name: string, value: string): boolean {
  if (!/^[a-z][a-z0-9:_-]*$/i.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return false;
  if (lower === "href" || lower.endsWith(":href"))
    return value.trim().startsWith("#");
  if (/(javascript|vbscript|data)\s*:|expression\s*\(|@import/i.test(value))
    return false;
  // fill="url(#gradient)" is how gradients work; url() to anything else
  // isn't a reference to this picture.
  return !/url\s*\(/i.test(value.replace(/url\s*\(\s*['"]?#[^)]*\)/gi, ""));
}

function cleanSvgTree(el: Element): void {
  for (const attr of Array.from(el.attributes))
    if (!safeSvgAttribute(attr.name, attr.value)) el.removeAttributeNode(attr);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    const childEl = child as Element;
    const name = childEl.localName.toLowerCase();
    if (SVG_UNWRAP.has(name)) {
      cleanSvgTree(childEl);
      childEl.replaceWith(...Array.from(childEl.childNodes));
    } else if (SVG_ELEMENTS.has(name) && childEl.namespaceURI === SVG_NS) {
      cleanSvgTree(childEl);
    } else {
      childEl.remove();
    }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The data URL of a cleaned copy of `svg`, for an <img src>. */
export function svgDataUrl(svg: Element): string {
  const copy = svg.cloneNode(true) as Element;
  cleanSvgTree(copy);
  if (!copy.getAttribute("xmlns")) copy.setAttribute("xmlns", SVG_NS);
  const xml = new XMLSerializer().serializeToString(copy);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

/** An inline <svg> as the picture it draws. */
function svgToImage(svg: Element, doc: Document): HTMLImageElement {
  const img = doc.createElement("img");
  img.setAttribute("src", svgDataUrl(svg));
  img.className = "html-svg";
  const label =
    svg.getAttribute("aria-label") ??
    svg.querySelector("title")?.textContent ??
    "";
  img.setAttribute("alt", label.trim());
  // Sized as written; without width/height the SVG's own viewBox decides.
  for (const dim of ["width", "height"]) {
    const value = svg.getAttribute(dim);
    const safe = value && sanitizeDimension(value);
    if (safe) img.setAttribute(dim, safe);
  }
  return img;
}

// --- the walk ------------------------------------------------------------

type AttrRule = (value: string) => string | null;
const keep: AttrRule = (v) => v;

const ATTR_RULES: Record<string, Record<string, AttrRule>> = {
  img: {
    src: sanitizeImageSrc,
    alt: keep,
    title: keep,
    width: sanitizeDimension,
    height: sanitizeDimension,
  },
  a: { href: sanitizeUrl, title: keep },
  th: { colspan: sanitizeSpan, rowspan: sanitizeSpan },
  td: { colspan: sanitizeSpan, rowspan: sanitizeSpan },
  ol: { start: (v) => (/^-?\d{1,6}$/.test(v.trim()) ? v.trim() : null) },
  details: { open: () => "" },
  // Markdown's own code fences name their language this way (a Mermaid
  // fence is found by it).
  code: {
    class: (v) => (/^language-[\w+#-]+$/.test(v.trim()) ? v.trim() : null),
  },
};

export interface PolicyOptions {
  /** Links open outside the editor (WYSIWYG widgets). */
  linkTarget?: boolean;
  /** Lets the caller put trusted output of its own in place of an element
   *  it planted (the split view's math): a node to insert, or undefined to
   *  sanitize the element as usual. */
  replace?: (el: Element) => Node | undefined;
}

/** Copies the allowed part of `nodes` into `out` (in `out`'s document). */
export function sanitizeNodes(
  nodes: Iterable<ChildNode>,
  out: Element | DocumentFragment,
  options: PolicyOptions = {},
): void {
  for (const node of nodes) cleanNode(node, out, options);
}

function cleanNode(
  node: ChildNode,
  out: Element | DocumentFragment,
  options: PolicyOptions,
): void {
  const doc = out.ownerDocument;
  if (node.nodeType === Node.TEXT_NODE) {
    out.appendChild(doc.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // comments, etc. - dropped

  const el = node as Element;
  const replacement = options.replace?.(el);
  if (replacement) {
    out.appendChild(replacement);
    return;
  }
  const tag = el.localName.toLowerCase();

  if (DANGEROUS_TAGS.has(tag)) return; // drop entirely, including content
  if (tag === "svg") {
    out.appendChild(svgToImage(el, doc));
    return;
  }
  // Only HTML elements from here on: an SVG or MathML child out of place
  // unwraps to its text.
  if (!ALLOWED_TAGS.has(tag) || el.namespaceURI !== HTML_NS) {
    for (const child of Array.from(el.childNodes))
      cleanNode(child, out, options);
    return;
  }

  const clean = doc.createElement(tag);
  const styles: string[] = [];
  if (ALIGN_TAGS.has(tag)) {
    const align = sanitizeAlign(el.getAttribute("align") ?? "");
    if (align) {
      clean.setAttribute("align", align);
      // A theme's `th { text-align: left }` outranks the attribute; as a
      // style it holds, as GitHub shows it.
      if (tag === "th" || tag === "td") styles.push(`text-align: ${align}`);
    }
  }
  const rules = ATTR_RULES[tag];
  if (rules) {
    for (const [attr, validate] of Object.entries(rules)) {
      const value = el.getAttribute(attr);
      if (value == null) continue;
      const safe = validate(value);
      if (safe != null) clean.setAttribute(attr, safe);
    }
  }
  const style = sanitizeStyle(el.getAttribute("style") ?? "");
  if (style) styles.push(style);
  if (styles.length > 0) clean.setAttribute("style", styles.join("; "));

  if (tag === "input") {
    // A task-list box, shown, never a field to type in.
    if (el.getAttribute("type")?.toLowerCase() !== "checkbox") return;
    clean.setAttribute("type", "checkbox");
    clean.setAttribute("disabled", "");
    if (el.hasAttribute("checked")) clean.setAttribute("checked", "");
  }
  if (tag === "a" && options.linkTarget) {
    clean.setAttribute("rel", "noopener noreferrer");
    clean.setAttribute("target", "_blank");
  }
  for (const child of Array.from(el.childNodes))
    cleanNode(child, clean, options);
  out.appendChild(clean);
}

const HTML_NS = "http://www.w3.org/1999/xhtml";
