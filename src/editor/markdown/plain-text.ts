import type { Fragment, Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * The plain-text flavor of a copy: the words as they read, not the Markdown
 * source. A link keeps its address after its text, lists keep a marker, a
 * table is tab-separated.
 */
export function plainTextOf(content: Fragment): string {
  return blocks(content).join("\n\n");
}

/** Each block's text, top to bottom. A fragment of inline content is one
 *  block. */
function blocks(content: Fragment): string[] {
  const out: string[] = [];
  let inline: ProseNode[] = [];
  const flush = () => {
    if (inline.length) out.push(inlineText(inline));
    inline = [];
  };
  content.forEach((node) => {
    if (node.isInline) {
      inline.push(node);
      return;
    }
    flush();
    const text = block(node);
    if (text !== null) out.push(text);
  });
  flush();
  return out;
}

function block(node: ProseNode): string | null {
  switch (node.type.name) {
    case "code_block":
    case "math_block":
      return node.textContent;
    case "hr":
      return "———";
    // Raw HTML (comments, tags) is markup, not words on the page.
    case "html":
      return null;
    case "bullet_list":
    case "ordered_list":
      return list(node);
    case "table":
      return table(node);
    default:
      // A paragraph with nothing that reads leaves no blank line behind.
      if (node.isTextblock) return inlineText(childrenOf(node)) || null;
      // Quotes, alerts and other wrappers: their blocks, one per paragraph.
      return blocks(node.content).join("\n\n");
  }
}

function list(node: ProseNode): string {
  const ordered = node.type.name === "ordered_list";
  const start = Number(node.attrs.order ?? node.attrs.start ?? 1) || 1;
  const lines: string[] = [];
  node.forEach((item, _offset, index) => {
    const checked = item.attrs.checked as boolean | null | undefined;
    const marker =
      checked === true
        ? "☑ "
        : checked === false
          ? "☐ "
          : ordered
            ? `${start + index}. `
            : "• ";
    const indent = " ".repeat(marker.length);
    const [first = "", ...rest] = blocks(item.content).join("\n").split("\n");
    lines.push(marker + first, ...rest.map((l) => (l ? indent + l : l)));
  });
  return lines.join("\n");
}

function table(node: ProseNode): string {
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(blocks(cell.content).join(" ")));
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}

function childrenOf(node: ProseNode): ProseNode[] {
  const out: ProseNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/** Inline content as read: a link's address after its text, a line break
 *  as a newline, an image as its alt text. */
function inlineText(nodes: ProseNode[]): string {
  const runs: { text: string; href: string | null }[] = [];
  const walk = (node: ProseNode) => {
    if (node.isText) {
      const link = node.marks.find((m) => m.type.name === "link");
      runs.push({
        text: node.text ?? "",
        href: link ? String(link.attrs.href ?? "") : null,
      });
    } else if (node.type.name === "hardbreak") {
      runs.push({ text: "\n", href: null });
    } else if (node.type.name === "image") {
      runs.push({ text: String(node.attrs.alt ?? ""), href: null });
    } else if (node.type.name === "html") {
      // Inline raw HTML is not part of what reads.
    } else {
      node.forEach(walk);
    }
  };
  nodes.forEach(walk);

  let out = "";
  for (let i = 0; i < runs.length;) {
    const href = runs[i].href;
    let text = "";
    while (i < runs.length && runs[i].href === href) text += runs[i++].text;
    out += text;
    if (href && !sameAddress(text, href)) out += ` (${href})`;
  }
  return out;
}

/** The link's text is its address already, so repeating it would double it. */
function sameAddress(text: string, href: string): boolean {
  const bare = (s: string) =>
    s
      .trim()
      .replace(/^mailto:/i, "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "");
  return bare(text) === bare(href);
}
