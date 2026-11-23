import { eachLine } from "../../utils/markdown-lines";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * The document's blocks as the model sees them: the editor's top-level nodes,
 * each with an id and a kind. An id hashes the block's markdown, so a stale id
 * names nothing rather than the wrong block.
 */

/** What a block is, read from its node. */
export type BlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "quote"
  | "code"
  | "math"
  | "table"
  | "rule"
  | "picture"
  | "html"
  | "footnote"
  | "definition"
  | "other";

/** One block as the request carries it. */
export interface SentBlock {
  id: string;
  markdown: string;
  kind: BlockKind;
}

const NODE_KINDS: Record<string, BlockKind> = {
  paragraph: "paragraph",
  heading: "heading",
  bullet_list: "list",
  ordered_list: "list",
  blockquote: "quote",
  code_block: "code",
  math_block: "math",
  table: "table",
  hr: "rule",
  html: "html",
  footnote_definition: "footnote",
};

/** What a top-level node is. A paragraph with no text of its own is a
 *  picture, an HTML block or a link definition. */
export function blockKind(node: ProseNode): BlockKind {
  const kind = NODE_KINDS[node.type.name] ?? "other";
  if (kind !== "paragraph" || node.childCount === 0) return kind;
  const children = new Set<string>();
  let ownText = false;
  node.forEach((child) => {
    ownText ||= child.isText;
    children.add(child.type.name);
  });
  if (ownText) return "paragraph";
  if (children.has("link_definition")) return "definition";
  if (children.has("html")) return "html";
  return "picture";
}

/** FNV-1a over the block's UTF-8 bytes, as four base-36 digits. */
function hashId(text: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    const d = h % 36;
    out += d < 10 ? String.fromCharCode(48 + d) : String.fromCharCode(87 + d);
    h = Math.floor(h / 36);
  }
  return out;
}

/** Each block's id, in order: its hash, `-2`, `-3`… after it where the
 *  same markdown came before. */
export function blockIds(markdowns: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return markdowns.map((markdown) => {
    const base = hashId(markdown);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** An id as the model may write it (`k3f9`, `#k3f9`, `[#k3f9]`) as the id. */
function cleanId(id: string): string {
  return id
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^#/, "")
    .trim();
}

/** The run's first and last index among `blocks`, or null when an id names
 *  none of them or the run is backwards. */
export function runOf(
  blocks: readonly { id: string }[],
  block: string,
  lastBlock?: string,
): { first: number; last: number } | null {
  const first = blocks.findIndex((b) => b.id === cleanId(block));
  if (first === -1) return null;
  if (!lastBlock) return { first, last: first };
  const last = blocks.findIndex((b) => b.id === cleanId(lastBlock));
  return last < first ? null : { first, last };
}

/** Edit fields as a call has them (streaming, or complete). */
interface BlockEditFields {
  action: string;
  block: string;
  lastBlock?: string;
  /** Words quoted inside the block, when the edit is about those. */
  anchor?: string;
  text: string;
}

/**
 * A block-named edit as the backend applies it, for a call still streaming.
 * Quoted words a `replace`/`delete` changes are changed in the whole run; an
 * insertion keeps them as anchor. Null when the ids or quote don't resolve.
 */
export function resolveBlockEdit(
  blocks: readonly SentBlock[],
  fields: BlockEditFields,
  complete = false,
): {
  action: string;
  block: string;
  lastBlock?: string;
  anchor: string;
  text: string;
} | null {
  const run = runOf(blocks, fields.block, fields.lastBlock);
  if (!run) return null;
  const runBlocks = blocks.slice(run.first, run.last + 1);
  const runText = runBlocks.map((b) => b.markdown).join("\n\n");
  const ids = {
    block: runBlocks[0].id,
    ...(run.last > run.first ? { lastBlock: runBlocks.at(-1)!.id } : {}),
  };
  const quote = fields.anchor;
  if (quote && quote !== runText) {
    if (runText.split(quote).length !== 2) return null;
    if (fields.action === "insert_after" || fields.action === "insert_before")
      return {
        ...ids,
        action: fields.action,
        anchor: quote,
        text: fields.text,
      };
    if (fields.action === "replace" || fields.action === "delete") {
      const with_ = fields.action === "delete" ? "" : fields.text;
      return {
        ...ids,
        action: "replace",
        anchor: runText,
        text: runText.replace(quote, () => with_),
      };
    }
  }
  return {
    ...ids,
    action: fields.action,
    anchor: runText,
    text:
      fields.action === "replace" && run.last > run.first
        ? keepPictures(runBlocks, fields.text, complete).text
        : fields.text,
  };
}

/** Every picture inside a text, with its description and address (an
 *  address in `<>` keeps its brackets). */
export const PICTURES_IN_TEXT =
  /!\[([^\]]*)\]\((<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g;

/** Whether `block` is a picture and nothing else: `![alt](path)` or an
 *  `<img>`. Must match the backend's; keep-pictures-cases.json holds both. */
export function isPicture(block: string): boolean {
  return /^(?:!\[[^\]\n]*\]\([^)\n]*\)|<img\s[^>\n]*>)$/.test(block.trim());
}

/** The model's text in paragraphs: runs of lines between blank lines, a
 *  fenced block (code or `$$` maths) whole, with where each is. */
export function textParagraphs(
  text: string,
): { text: string; from: number; to: number }[] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  let end = 0;
  let offset = 0;
  eachLine(
    text,
    (line, _index, code) => {
      const bare = line.replace(/\r$/, "");
      if (code || bare.trim() !== "") {
        start ??= offset;
        end = offset + bare.length;
      } else if (start !== null) {
        spans.push([start, end]);
        start = null;
      }
      offset += line.length + 1;
    },
    { math: true },
  );
  if (start !== null) spans.push([start, end]);
  return spans.map(([from, to]) => ({ text: text.slice(from, to), from, to }));
}

/** An address as written in `<>`, without them; a lone `<` or `>` is part
 *  of it. The backend's unbracket. */
function unbracket(src: string): string {
  return src.length > 1 && src.startsWith("<") && src.endsWith(">")
    ? src.slice(1, -1)
    : src;
}

/** A picture's address: what makes it the same picture whatever its
 *  description says. `![alt](<a b.png> "title")` is `a b.png`; an `<img>`'s
 *  src may be unquoted, and one with none is known by its text. Must match
 *  the backend's picture_src (src-tauri/src/ai/doc_blocks/pictures.rs). */
function pictureSrc(picture: string): string {
  const t = picture.trim();
  const md = /^!\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]*)/.exec(t);
  if (md) return unbracket(md[1]);
  const img =
    /^<img\s[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(t);
  return img ? (img[1] ?? img[2] ?? img[3]) : t;
}

/** `original` with the description `rewritten` gives it: the writer's
 *  address and title stay. An `<img>` stays as it is. */
function withDescription(original: string, rewritten: string): string {
  const alt = /^!\[([^\]\n]*)\]\(/.exec(rewritten.trim())?.[1];
  const rest = /^!\[[^\]\n]*\](\(.*\))$/.exec(original.trim())?.[1];
  return alt === undefined || rest === undefined
    ? original.trim()
    : `![${alt}]${rest}`;
}

/** `text` with each line that is one of `srcs`' pictures in a paragraph of
 *  other lines put in a paragraph of its own, as the writer's picture is:
 *  "![a](a.png)\n*Figure 1*" would read as one paragraph, the picture
 *  beside its caption. A line in a fence or `$$` block, or in an HTML
 *  block, is that block's and stays. Must match the backend's
 *  pictures_apart (src-tauri/src/ai/doc_blocks/pictures.rs). */
function picturesApart(text: string, srcs: ReadonlySet<string>): string {
  let out = text;
  for (const p of textParagraphs(text).reverse()) {
    const lines = p.text.split("\n");
    if (lines.length < 2 || opensHtml(lines[0])) continue;
    const code: boolean[] = [];
    eachLine(p.text, (_line, i, isCode) => (code[i] = isCode), { math: true });
    const apart = lines.map(
      (line, i) => !code[i] && isPicture(line) && srcs.has(pictureSrc(line)),
    );
    if (!apart.includes(true)) continue;
    const groups: string[][] = [];
    let lastApart = false;
    lines.forEach((line, i) => {
      const last = groups.at(-1);
      if (apart[i] || !last || lastApart) groups.push([line]);
      else last.push(line);
      lastApart = apart[i];
    });
    const parts = groups.map((g) => g.join("\n"));
    out = `${out.slice(0, p.from)}${parts.join("\n\n")}${out.slice(p.to)}`;
  }
  return out;
}

/** Whether a paragraph whose first line is `line` is an HTML block: it
 *  opens with a tag, and isn't one of the pictures. */
function opensHtml(line: string): boolean {
  return /^ {0,3}<[A-Za-z/!?]/.test(line) && !isPicture(line);
}

/**
 * `text`, a rewrite of `run`, with the run's pictures as they were: a
 * picture is the same by its address, so the rewrite may change its
 * description but never what it shows; a new picture where one was is
 * taken out, and each one left out goes back by its paragraph. While
 * streaming (`!complete`), pictures not yet reached wait. Must match the
 * backend's keep_pictures (src-tauri/src/ai/doc_blocks/pictures.rs).
 */
export function keepPictures(
  run: readonly { markdown: string }[],
  text: string,
  complete: boolean,
): { text: string; swapped: number } {
  const blocks = run.map((b) => b.markdown.trim());
  const originals = blocks.flatMap((b, i) => {
    return isPicture(b) ? [{ at: i, markdown: b, src: pictureSrc(b) }] : [];
  });
  if (originals.length === 0) return { text, swapped: 0 };
  const srcs = new Set(originals.map((o) => o.src));
  const shown = new Set<number>();
  // The writer's picture the rewrite's `src` is, not taken yet.
  const take = (src: string) => {
    const o = originals.find((p) => p.src === src && !shown.has(p.at));
    if (o) shown.add(o.at);
    return o;
  };
  const spaced = picturesApart(text, srcs);
  // Once: this runs on every streamed chunk.
  const spacedParts = textParagraphs(spaced);
  const paragraphs = spacedParts.map((p) => {
    if (isPicture(p.text)) {
      const o = take(pictureSrc(p.text));
      return { text: o ? withDescription(o.markdown, p.text) : p.text, o };
    }
    // A picture inside the words is shown there.
    for (const m of p.text.matchAll(PICTURES_IN_TEXT)) take(unbracket(m[2]));
    return { text: p.text, o: undefined };
  });
  const missing = originals.length - shown.size;
  let swapped = 0;
  const kept = paragraphs.filter((p) => {
    const isNew = !p.o && isPicture(p.text) && !srcs.has(pictureSrc(p.text));
    if (isNew && swapped < missing) {
      swapped++;
      return false;
    }
    return true;
  });
  const rewritten =
    spaced !== text ||
    swapped > 0 ||
    paragraphs.some((p, k) => p.text !== spacedParts[k].text);
  let out = rewritten ? kept.map((p) => p.text).join("\n\n") : text;
  let wordsBefore = 0;
  // Pictures in the new text so far: each moves the later places on by one.
  let put = 0;
  blocks.forEach((picture, i) => {
    if (!originals.some((o) => o.at === i)) {
      wordsBefore++;
      return;
    }
    // Kept where the rewrite has it, it takes a place all the same.
    if (shown.has(i)) {
      put++;
      return;
    }
    const at = wordsBefore + put;
    const spans = textParagraphs(out);
    if (at === 0) out = `${picture}\n\n${out.trimStart()}`;
    else if (at < spans.length) {
      const end = spans[at - 1].to;
      out = `${out.slice(0, end)}\n\n${picture}\n\n${out.slice(end).trimStart()}`;
    } else if (complete && spans.length > 0)
      out = `${out.trimEnd()}\n\n${picture}`;
    else return;
    put++;
  });
  return { text: out, swapped };
}

/**
 * Where a block-named add_comment or generate_image points: a phrase the
 * block holds once stays the anchor, else the whole block. Null while
 * neither names anything in `blocks`.
 */
export function resolveBlockTarget(
  blocks: readonly SentBlock[],
  fields: { block?: string; anchor?: string },
): { block?: string; anchor: string } | null {
  if (!fields.block) return fields.anchor ? { anchor: fields.anchor } : null;
  const run = runOf(blocks, fields.block);
  if (!run) return null;
  const { id, markdown } = blocks[run.first];
  const phrase = fields.anchor;
  return phrase && phrase !== markdown && markdown.split(phrase).length === 2
    ? { block: id, anchor: phrase }
    : { block: id, anchor: markdown };
}
