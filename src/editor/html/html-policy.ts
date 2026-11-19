import {
  ALIGN_TAGS,
  sanitizeAlign,
  sanitizeDimension,
  sanitizeImageSrc,
  sanitizeSpan,
  sanitizeStyle,
  sanitizeUrl,
} from "./html-values";
import { svgToImage } from "./html-svg";

/**
 * The one HTML allow-list for a document's own markup, shared by the editor
 * and the split view. It is strict because the window's CSP still allows
 * inline scripts and Tauri IPC: anything that runs in a document runs on the
 * user's machine.
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
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
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
  "abbr",
  "q",
  "cite",
  "dfn",
  "samp",
  "var",
  "tt",
  "strike",
  "time",
  "wbr",
  "ruby",
  "rt",
  "rp",
  // Drawn as its images, below.
  "picture",
]);
export const ALLOWED_TAGS = new Set([...BLOCK_TAGS, ...INLINE_TAGS, "svg"]);

// Dropped with their children; tags merely not allowed unwrap instead.
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

// --- picture -------------------------------------------------------------

const SCHEME_RE = /prefers-color-scheme\s*:\s*(dark|light)/i;

/**
 * A README's <picture> of a light and a dark logo: one <img> for each,
 * classed by scheme, so Textus's theme picks it (the browser's own choice
 * would follow the system, not the theme). Without such sources, its <img>.
 */
function pictureImages(picture: Element, doc: Document): Element[] {
  const fallback = picture.querySelector("img");
  const bySchema = new Map<string, string>();
  for (const source of Array.from(picture.querySelectorAll("source"))) {
    const scheme = SCHEME_RE.exec(source.getAttribute("media") ?? "")?.[1];
    const first = (source.getAttribute("srcset") ?? "")
      .split(",")[0]
      ?.trim()
      .split(/\s+/)[0];
    if (scheme && first && !bySchema.has(scheme))
      bySchema.set(scheme.toLowerCase(), first);
  }
  if (bySchema.size === 0) return fallback ? [fallback] : [];
  return (["light", "dark"] as const).map((scheme) => {
    const img = doc.createElement("img");
    for (const attr of ["alt", "title", "width", "height"]) {
      const value = fallback?.getAttribute(attr);
      if (value != null) img.setAttribute(attr, value);
    }
    img.setAttribute(
      "src",
      bySchema.get(scheme) ?? fallback?.getAttribute("src") ?? "",
    );
    img.setAttribute("data-scheme", scheme);
    return img;
  });
}

// --- the walk ------------------------------------------------------------

type AttrRule = (value: string) => string | null;
const keep: AttrRule = (v) => v;

const ATTR_RULES: Record<string, Record<string, AttrRule>> = {
  img: {
    src: sanitizeImageSrc,
    "data-scheme": (v) => (v === "light" || v === "dark" ? v : null),
    alt: keep,
    title: keep,
    width: sanitizeDimension,
    height: sanitizeDimension,
  },
  a: { href: sanitizeUrl, title: keep },
  abbr: { title: keep },
  dfn: { title: keep },
  time: { datetime: keep },
  th: { colspan: sanitizeSpan, rowspan: sanitizeSpan },
  td: { colspan: sanitizeSpan, rowspan: sanitizeSpan },
  ol: { start: (v) => (/^-?\d{1,6}$/.test(v.trim()) ? v.trim() : null) },
  details: { open: () => "" },
  // Code fences name their language this way (a Mermaid fence is found by it).
  code: {
    class: (v) => (/^language-[\w+#-]+$/.test(v.trim()) ? v.trim() : null),
  },
};

interface PolicyOptions {
  /** Links open outside the editor (WYSIWYG widgets). */
  linkTarget?: boolean;
  /** Lets the caller put trusted output of its own in place of an element it
   *  planted: a node to insert, or undefined to sanitize as usual. */
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
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const replacement = options.replace?.(el);
  if (replacement) {
    out.appendChild(replacement);
    return;
  }
  const tag = el.localName.toLowerCase();

  if (DANGEROUS_TAGS.has(tag)) return;
  if (tag === "picture") {
    for (const img of pictureImages(el, doc)) cleanNode(img, out, options);
    return;
  }
  if (tag === "svg") {
    out.appendChild(svgToImage(el, doc));
    return;
  }
  // Only HTML elements from here on: SVG or MathML out of place unwraps.
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
      // A theme's `th { text-align: left }` outranks the attribute; a style holds.
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
