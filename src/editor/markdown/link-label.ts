import { fromMarkdown } from "mdast-util-from-markdown";

/**
 * How a link's label is drawn while its source is hidden: bold, italic,
 * code and the rest as their tags, delimiters and escapes hidden, an image
 * as the picture. Worked out from the label's mdast, offsets in the label.
 */

export type LabelPart =
  | { kind: "hide"; from: number; to: number }
  | { kind: "tag"; from: number; to: number; tag: string }
  | { kind: "image"; from: number; to: number; src: string; alt: string };

interface Mdast {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: Mdast[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const TAGS: Record<string, string> = {
  strong: "strong",
  emphasis: "em",
  delete: "del",
  mark: "mark",
  superscript: "sup",
  inlineCode: "code",
};

const span = (node: Mdast): [number, number] | null => {
  const from = node.position?.start?.offset;
  const to = node.position?.end?.offset;
  return from === undefined || to === undefined ? null : [from, to];
};

/** The parts of `label` drawn differently from plain text. `parse` reads
 *  Markdown to mdast with positions. */
export function labelParts(
  label: string,
  parse: (markdown: string) => unknown,
): LabelPart[] {
  if (!/[\\*_~`=^!&]/.test(label)) return [];
  let root: Mdast;
  try {
    root = parse(label) as Mdast;
  } catch {
    return [];
  }
  const paragraph = root.children?.[0];
  if (root.children?.length !== 1 || paragraph?.type !== "paragraph") return [];
  const parts: LabelPart[] = [];
  const walk = (node: Mdast) => {
    const at = span(node);
    if (!at) return;
    const [from, to] = at;
    if (node.type === "text") {
      // A backslash escape reads as the character after it.
      const source = label.slice(from, to);
      if (source.length !== node.value?.length)
        for (const match of source.matchAll(/\\(?=[!-/:-@[-`{-~])/g))
          parts.push({
            kind: "hide",
            from: from + match.index!,
            to: from + match.index! + 1,
          });
      return;
    }
    if (node.type === "image") {
      parts.push({
        kind: "image",
        from,
        to,
        src: node.url ?? "",
        alt: node.alt ?? "",
      });
      return;
    }
    const tag = TAGS[node.type];
    if (node.type === "inlineCode") {
      const ticks = /^`+ ?/.exec(label.slice(from, to))?.[0].length ?? 1;
      const close = / ?`+$/.exec(label.slice(from, to))?.[0].length ?? 1;
      parts.push(
        { kind: "hide", from, to: from + ticks },
        { kind: "tag", from: from + ticks, to: to - close, tag },
        { kind: "hide", from: to - close, to },
      );
      return;
    }
    const children = node.children ?? [];
    const first = children[0] && span(children[0]);
    const last =
      children[children.length - 1] && span(children[children.length - 1]);
    if (tag && first && last) {
      parts.push(
        { kind: "hide", from, to: first[0] },
        { kind: "tag", from: first[0], to: last[1], tag },
        { kind: "hide", from: last[1], to },
      );
    }
    children.forEach(walk);
  };
  paragraph.children?.forEach(walk);
  return parts.filter((part) => part.from < part.to);
}

/** The inline mdast of `label` alone; null when it isn't one paragraph. */
function labelInline(label: string): Mdast[] | null {
  const root = fromMarkdown(label) as Mdast;
  const paragraph = root.children?.[0];
  return root.children?.length === 1 && paragraph?.type === "paragraph"
    ? (paragraph.children ?? [])
    : null;
}

const readAs = (node: Mdast): string =>
  node.type === "image"
    ? (node.alt ?? "")
    : node.type === "html"
      ? ""
      : (node.value ?? (node.children ?? []).map(readAs).join(""));

/** What `label` reads as: its text without delimiters, an image as its alt. */
export function labelText(label: string): string {
  if (!/[\\*_`!&<]/.test(label)) return label;
  return labelInline(label)?.map(readAs).join("") ?? label;
}

function toDOM(node: Mdast): Node {
  if (node.type === "image") {
    const img = document.createElement("img");
    img.src = node.url ?? "";
    img.alt = node.alt ?? "";
    return img;
  }
  const tag = TAGS[node.type];
  if (!tag) return document.createTextNode(readAs(node));
  const el = document.createElement(tag);
  if (node.type === "inlineCode") el.textContent = node.value ?? "";
  else el.append(...(node.children ?? []).map(toDOM));
  return el;
}

/** `label` as HTML for other apps: bold, italic, code, images. */
export function labelNodes(label: string): Node[] {
  return (labelInline(label) ?? [{ type: "text", value: label }]).map(toDOM);
}

const DELIMS: Record<string, string> = {
  STRONG: "**",
  B: "**",
  EM: "*",
  I: "*",
  DEL: "~~",
  S: "~~",
};

/** `text` as label Markdown that reads as itself. */
export const escapeLabel = (text: string) =>
  text.replace(/([\\[\]*_`])/g, "\\$1");

/** A pasted link's content as its label's Markdown. */
export function labelMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeLabel(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (el.tagName === "IMG") {
    const src = el.getAttribute("src") ?? "";
    const dest = /[\s()<>]/.test(src) ? `<${src}>` : src;
    return `![${escapeLabel(el.getAttribute("alt") ?? "")}](${dest})`;
  }
  if (el.tagName === "CODE") {
    const code = el.textContent ?? "";
    const ticks = "`".repeat(
      Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length)) + 1,
    );
    const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
    return code ? `${ticks}${pad}${code}${pad}${ticks}` : "";
  }
  const inner = [...el.childNodes].map(labelMarkdown).join("");
  const delim = DELIMS[el.tagName];
  return delim && inner.trim() ? `${delim}${inner}${delim}` : inner;
}
