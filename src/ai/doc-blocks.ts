/**
 * The document's blocks and their ids, split exactly as the backend splits
 * them for the model (src-tauri/src/ai/doc_blocks.rs - the two are held to
 * the same cases by doc-blocks-cases.json). The model names the block an
 * edit changes (`block`, and `last_block` for a run of them) instead of
 * quoting it; the backend turns that into an anchor before the call reaches
 * the history, so only a streaming draft needs it here - to show the edit
 * the moment its block is named, rather than when the call is complete.
 */

/** One block: its id, its markdown and where that is in the document. */
export interface DocBlock {
  id: string;
  text: string;
  from: number;
  to: number;
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

/** The marker a fenced block opens with: ``` or ~~~ code, $$ maths. */
function fenceOpening(line: string): string | null {
  const t = line.trimStart();
  for (const marker of ["```", "~~~", "$$"])
    if (t.startsWith(marker)) return marker;
  return null;
}

/** The document's blocks: runs of lines between blank lines, a fenced code
 *  or maths block whole. */
export function splitBlocks(document: string): DocBlock[] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  let end = 0;
  let fence: string | null = null;
  let offset = 0;
  for (const raw of document.split(/(?<=\n)/)) {
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
  const seen = new Map<string, number>();
  return spans.map(([from, to]) => {
    const text = document.slice(from, to);
    const base = hashId(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, text, from, to };
  });
}

/** Edit fields as a streaming call has them so far. */
export interface BlockEditFields {
  action: string;
  block?: string;
  lastBlock?: string;
  anchor?: string;
  text: string;
}

/**
 * The anchor and text an edit by block comes to - what the backend's
 * resolve_edit_arguments makes of it: the block's (or the run's) whole
 * text as the anchor, and a few words quoted inside it changed in it.
 * Null when the ids name no block of `document` as it is now (it changed
 * since the request): the draft waits for the completed call then.
 */
export function resolveBlockEdit(
  document: string,
  fields: BlockEditFields,
): { anchor: string; text: string; action: string; context?: string } | null {
  if (!fields.block) return null;
  const blocks = splitBlocks(document);
  const first = blocks.findIndex(
    (b) => b.id === fields.block!.replace(/^#/, ""),
  );
  if (first === -1) return null;
  let last = first;
  if (fields.lastBlock) {
    last = blocks.findIndex(
      (b) => b.id === fields.lastBlock!.replace(/^#/, ""),
    );
    if (last < first) return null;
  }
  // A run is the document's own text from its first block to its last.
  const runText = document.slice(blocks[first].from, blocks[last].to);
  // A run repeated word for word is told apart by the block before it.
  const context =
    document.split(runText).length > 2 && first > 0
      ? document.slice(blocks[first - 1].from, blocks[last].to)
      : undefined;
  const part = fields.anchor;
  // Inserting next to words inside the block stays next to them, the
  // block telling which of them is meant.
  if (
    part &&
    part !== runText &&
    (fields.action === "insert_after" || fields.action === "insert_before")
  ) {
    const inBlock = runText.split(part).length === 2;
    const repeated = document.split(part).length > 2;
    return {
      action: fields.action,
      anchor: part,
      text: fields.text,
      ...(inBlock && repeated ? { context: runText } : {}),
    };
  }
  if (
    part &&
    part !== runText &&
    (fields.action === "replace" || fields.action === "delete")
  ) {
    if (runText.split(part).length !== 2) return null;
    const with_ = fields.action === "delete" ? "" : fields.text;
    return {
      action: "replace",
      anchor: runText,
      text: runText.replace(part, () => with_),
      ...(context ? { context } : {}),
    };
  }
  return {
    action: fields.action,
    anchor: runText,
    text:
      fields.action === "replace" && last > first
        ? keepPictures(blocks.slice(first, last + 1), fields.text, false)
        : fields.text,
    ...(context ? { context } : {}),
  };
}

/** Whether `block` is a picture and nothing else: `![alt](path)`, or an
 *  `<img>` (a picture given a width). doc_blocks.rs's is_picture; the rest
 *  of the app asks markdown-forms.ts, which has it from here. */
export function isPicture(block: string): boolean {
  return /^(?:!\[[^\]\n]*\]\([^)\n]*\)|<img\s[^>\n]*>)$/.test(block.trim());
}

/**
 * `text`, a rewrite of the run `run`, with the run's pictures it left out
 * put back, each after as many of the new text's blocks as there were
 * text blocks before it in the run - doc_blocks.rs's keep_pictures, which
 * the finished call goes through (a dropped picture was deleted with
 * nothing said). `complete`: all of `text` is there; while it streams in,
 * a picture whose place it hasn't reached is left out for now.
 */
export function keepPictures(
  run: DocBlock[],
  text: string,
  complete: boolean,
): string {
  let out = text;
  let wordsBefore = 0;
  // Pictures in the new text so far: each moves the later places on by one.
  let put = 0;
  for (const block of run) {
    const picture = block.text.trim();
    if (!isPicture(picture)) {
      wordsBefore++;
      continue;
    }
    // Kept where the rewrite has it, it takes a place all the same.
    if (out.includes(picture)) {
      put++;
      continue;
    }
    const blocks = splitBlocks(out);
    const at = wordsBefore + put;
    if (at === 0) out = `${picture}\n\n${out.trimStart()}`;
    else if (at < blocks.length) {
      const end = blocks[at - 1].to;
      out = `${out.slice(0, end)}\n\n${picture}\n\n${out.slice(end).trimStart()}`;
    } else if (complete && blocks.length > 0)
      out = `${out.trimEnd()}\n\n${picture}`;
    else continue;
    put++;
  }
  return out;
}

/**
 * Where an add_comment or generate_image call named by its block points,
 * as doc_blocks.rs's resolve_target_arguments makes it: a phrase quoted in
 * `anchor` that the block holds once stays the anchor (pinned by the whole
 * block where it repeats in the document), else the anchor is the whole
 * block. Without a block, the anchor as quoted. Null while neither names
 * anything in `document`.
 */
export function resolveBlockTarget(
  document: string,
  fields: { block?: string; anchor?: string },
): { anchor: string; context?: string } | null {
  if (!fields.block) return fields.anchor ? { anchor: fields.anchor } : null;
  const blocks = splitBlocks(document);
  const index = blocks.findIndex(
    (b) => b.id === fields.block!.replace(/^#/, ""),
  );
  if (index === -1) return null;
  const whole = blocks[index].text;
  const phrase = fields.anchor;
  if (phrase && phrase !== whole && whole.split(phrase).length === 2)
    return document.split(phrase).length > 2
      ? { anchor: phrase, context: whole }
      : { anchor: phrase };
  return document.split(whole).length > 2 && index > 0
    ? {
        anchor: whole,
        context: document.slice(blocks[index - 1].from, blocks[index].to),
      }
    : { anchor: whole };
}
