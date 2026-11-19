import { sanitizeDimension } from "./html-values";

/**
 * An inline <svg> kept as the picture it draws: its drawing elements only,
 * references inside itself only, shown through an <img>.
 */

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
// Also dropped: script, foreignObject, style (@import), image (loads a
// file), animate/set (can rewrite an href to javascript: after load).
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
export function svgToImage(svg: Element, doc: Document): HTMLImageElement {
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
