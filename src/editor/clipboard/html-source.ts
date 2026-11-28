import { escapeHtml } from "../../utils/html";

/**
 * A copy's HTML as source text, for a field that takes HTML code: the
 * markup a copy hands other apps (the clipboard serializer's), without the
 * editor's own classes and data attributes, a block a line.
 */

/** What a reader of the HTML needs; the rest is the editor's own. */
const KEPT_ATTRIBUTES = new Set([
  "href",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "start",
  "lang",
  "dir",
]);

const VOID = new Set(["br", "hr", "img", "col", "wbr"]);

/** Elements that start a line of their own. */
const BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "div",
  "figure",
  "figcaption",
  "details",
  "summary",
  "dl",
  "dt",
  "dd",
]);

/** A lone paragraph in these is their text: `<li>a</li>`, not
 *  `<li><p>a</p></li>`, as a tight Markdown list renders. */
const UNWRAP_LONE_PARAGRAPH = new Set(["li", "td", "th"]);

function attributesOf(el: Element): string {
  let out = "";
  for (const { name, value } of Array.from(el.attributes)) {
    if (KEPT_ATTRIBUTES.has(name) && value)
      out += ` ${name}="${escapeHtml(value)}"`;
  }
  return out;
}

function childrenOf(el: Element): ChildNode[] {
  const children = Array.from(el.childNodes);
  const tag = el.tagName.toLowerCase();
  const elements = children.filter((c) => c.nodeType === 1);
  const blank = children.every(
    (c) => c.nodeType === 1 || !(c.textContent ?? "").trim(),
  );
  if (
    UNWRAP_LONE_PARAGRAPH.has(tag) &&
    blank &&
    elements.length === 1 &&
    (elements[0] as Element).tagName === "P"
  )
    return Array.from(elements[0].childNodes);
  return children;
}

function source(node: ChildNode): string {
  if (node.nodeType === 3) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const attrs = attributesOf(el);
  // A span the editor drew for itself says nothing once its classes go.
  if (tag === "span" && !attrs) return childrenSource(el);
  if (VOID.has(tag)) {
    const html = `<${tag}${attrs}>`;
    return BLOCKS.has(tag) ? `\n${html}\n` : html;
  }
  // Code keeps its lines and spaces as they are.
  if (tag === "pre") return `\n<pre${attrs}>${preSource(el)}</pre>\n`;
  const inner = childrenSource(el);
  const html = `<${tag}${attrs}>${inner}</${tag}>`;
  return BLOCKS.has(tag) ? `\n${html}\n` : html;
}

function childrenSource(el: Element): string {
  return childrenOf(el).map(source).join("");
}

/** A code block's inside: a `<code>` naming its language as HTML does
 *  (`language-…`, read from the editor's `data-language`), the text
 *  unbroken. */
function preSource(pre: Element): string {
  const text = escapeHtml(pre.textContent ?? "");
  const language = pre.getAttribute("data-language");
  const named = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<code${named}>${text}</code>`;
}

/** `root`'s contents as HTML source, a block a line. */
export function htmlSource(root: ParentNode): string {
  const raw = Array.from(root.childNodes).map(source).join("");
  // Lines inside <pre> stay; between blocks one line break is enough.
  return raw
    .split(/(<pre[\s>][\s\S]*?<\/pre>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\n{2,}/g, "\n")))
    .join("")
    .trim();
}
