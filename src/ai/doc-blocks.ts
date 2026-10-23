import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * The document's blocks as the model sees them: the editor's own top-level
 * nodes, each with an id and a kind. The request carries this list
 * (doc-markdown.ts's serializeBlocks makes it); the backend shows each
 * block after its `[#k3f9]` and never splits the document itself, so the
 * blocks the model names are the nodes the editor has - a loose list or a
 * quote of several paragraphs is one block, as it is one node.
 *
 * An edit names its block (`block`, and `last_block` for a run of them)
 * instead of quoting it, and keeps the ids: the proposal is placed by them
 * (doc-markdown.ts's matchTarget), not by searching the document for its
 * text. An id is a hash of the block's markdown, so a block keeps its id
 * while it is unchanged, and an id from before a change names nothing
 * rather than the wrong block.
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

/** One block as the request carries it - `DocBlock` in doc_blocks.rs. */
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

/** What `node`, a top-level node, is. A paragraph with no text of its own
 *  is a picture's, an HTML block's (`paragraph > html`) or a link's
 *  definition (`paragraph > link_definition`). */
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

/** An id as the model may write it - `k3f9`, `#k3f9`, or the whole
 *  marker `[#k3f9]` it was shown - as the id. clean_id in doc_blocks.rs. */
export function cleanId(id: string): string {
  return id
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^#/, "")
    .trim();
}

/** Where `block` (and `lastBlock`) are among `blocks`: the run's first and
 *  last index, or null when an id names none of them or the run is
 *  backwards. */
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
export interface BlockEditFields {
  action: string;
  block: string;
  lastBlock?: string;
  /** Words quoted inside the block, when the edit is about those. */
  anchor?: string;
  text: string;
}

/**
 * An edit named by its block as it is applied - what the backend's
 * resolve_edit_arguments writes into the call, done here for a call still
 * streaming in: the run's text is the anchor; a few words quoted inside it
 * that a `replace` or `delete` changes are changed in the whole run (one
 * edit per block, as the card shows it); an insertion next to quoted words
 * keeps them as its anchor. A run's rewrite keeps the run's pictures
 * (keepPictures). Null when the ids name no run of `blocks` (the document
 * changed since the request) or the quote isn't in the run once.
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

/** Whether `block` is a picture and nothing else: `![alt](path)`, or an
 *  `<img>` (a picture given a width) - for text the model wrote, which has
 *  no node to ask. doc_blocks.rs's is_picture; both are held to
 *  keep-pictures-cases.json. */
export function isPicture(block: string): boolean {
  return /^(?:!\[[^\]\n]*\]\([^)\n]*\)|<img\s[^>\n]*>)$/.test(block.trim());
}

/** The marker a fenced block opens with: ``` or ~~~ code, $$ maths. */
function fenceOpening(line: string): string | null {
  const t = line.trimStart();
  for (const marker of ["```", "~~~", "$$"])
    if (t.startsWith(marker)) return marker;
  return null;
}

/** Text the model wrote, in its paragraphs: runs of lines between blank
 *  lines, a fenced code or maths block whole, with where each is. Only for
 *  the model's text - the document's blocks are the editor's nodes. */
export function textParagraphs(
  text: string,
): { text: string; from: number; to: number }[] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  let end = 0;
  let fence: string | null = null;
  let offset = 0;
  for (const raw of text.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    const lineEnd = offset + line.length;
    if (fence) {
      end = lineEnd;
      if (line.trimStart().startsWith(fence)) fence = null;
    } else if (line.trim() === "") {
      if (start !== null) spans.push([start, end]);
      start = null;
    } else {
      start ??= offset;
      end = lineEnd;
      const marker = fenceOpening(line);
      // A one-line `$$x$$` closes itself.
      if (
        marker &&
        !(marker === "$$" && line.trimStart().slice(2).trimEnd().endsWith("$$"))
      )
        fence = marker;
    }
    offset += raw.length;
  }
  if (start !== null) spans.push([start, end]);
  return spans.map(([from, to]) => ({ text: text.slice(from, to), from, to }));
}

/**
 * `text`, a rewrite of the run `run`, with the run's pictures as they were
 * - doc_blocks.rs's keep_pictures, which the finished call goes through: a
 * new picture written where one was is taken out, and each picture left
 * out goes back by the paragraph it stood by. `complete`: all of `text` is
 * there; while it streams in, a picture whose place it hasn't reached is
 * left out for now. With how many swapped pictures were taken out.
 */
export function keepPictures(
  run: readonly { markdown: string }[],
  text: string,
  complete: boolean,
): { text: string; swapped: number } {
  const originals = run.map((b) => b.markdown.trim()).filter(isPicture);
  const missing = originals.filter((p) => !text.includes(p)).length;
  let swapped = 0;
  const kept = textParagraphs(text).filter((b) => {
    const isNew = isPicture(b.text) && !originals.includes(b.text.trim());
    if (isNew && swapped < missing) {
      swapped++;
      return false;
    }
    return true;
  });
  let out = swapped ? kept.map((b) => b.text).join("\n\n") : text;
  let wordsBefore = 0;
  // Pictures in the new text so far: each moves the later places on by one.
  let put = 0;
  for (const block of run) {
    const picture = block.markdown.trim();
    if (!isPicture(picture)) {
      wordsBefore++;
      continue;
    }
    // Kept where the rewrite has it, it takes a place all the same.
    if (out.includes(picture)) {
      put++;
      continue;
    }
    const paragraphs = textParagraphs(out);
    const at = wordsBefore + put;
    if (at === 0) out = `${picture}\n\n${out.trimStart()}`;
    else if (at < paragraphs.length) {
      const end = paragraphs[at - 1].to;
      out = `${out.slice(0, end)}\n\n${picture}\n\n${out.slice(end).trimStart()}`;
    } else if (complete && paragraphs.length > 0)
      out = `${out.trimEnd()}\n\n${picture}`;
    else continue;
    put++;
  }
  return { text: out, swapped };
}

/**
 * Where an add_comment or generate_image call named by its block points,
 * as doc_blocks.rs's resolve_target_arguments makes it: a phrase quoted in
 * `anchor` that the block holds once stays the anchor, else the anchor is
 * the whole block. Without a block, the anchor as quoted. Null while
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
