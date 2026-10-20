import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { splitListItem } from "@milkdown/kit/prose/schema-list";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "./editor-test-harness";
import { toEditorText } from "../document/file-format";
import { toggleSpan } from "../editor/marks/span-commands";
import {
  readSourceBlocks,
  writePreservingSource,
  type SourceBlocks,
} from "../editor/markdown/source-preserving";

// Test-only: the save round trip (docs/dev/saving.md) run on real files.
// A file is opened in the full editor, as a tab opens it, one edit is made
// the way the app makes it, and the save is checked:
//
//   (a) every top-level block the edit didn't touch is in the output as
//       the file had it, byte for byte;
//   (b) the output, read again, holds the text the editor held - no text,
//       link target, image or footnote lost or garbled;
//   (c) nothing threw.
//
// Every edit starts from a fresh load. Edits are picked by a seeded random
// generator, so a failure reproduces from the file and the seed.

export const EDIT_KINDS = [
  "type-word",
  "delete-word",
  "toggle-bold",
  "add-list-item",
  "edit-table-cell",
  "insert-heading",
  "paste-markdown",
  "replace-paragraph",
  "undo-edit",
] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

/** Why a check failed. The `-serializer` kinds fail the same way when the
 *  whole document is serialized, so they are the serializer's, not the
 *  preservation's; the rest are preservation's. */
export type FailureKind =
  | "exception"
  | "undo-changed"
  | "unedited-changed"
  | "untouched-changed"
  | "text-changed"
  | "text-changed-serializer"
  | "blocks-changed"
  | "blocks-changed-serializer";

export interface Failure {
  kind: FailureKind;
  edit: EditKind | "none";
  seed: number;
  detail: string;
}

export interface FileReport {
  failures: Failure[];
  /** Edits made, by kind; an edit with nowhere to go (no table) isn't. */
  edits: Partial<Record<EditKind, number>>;
  /** The file's blocks didn't line up with the editor's on opening, so
   *  every save serializes the whole document. */
  unpaired: boolean;
  /** Blocks a plugin changed on load, written by the serializer on every
   *  save (with a short sample of each). */
  unkept: string[];
  /** Kept blocks next to an edit that the join check serialized. */
  neighboursSerialized: number;
  /** The whole document serialized, without preservation: how many
   *  top-level blocks come out different from the file, by kind. */
  serializeOnly: Record<string, number>;
  /** How many top-level stretches the file was paired into. */
  blocks: number;
}

/** A small, seedable generator (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)];

/** Which top-level blocks an edit touched (indexes in the opened doc),
 *  and where a new block went in. Null: nowhere to make this edit. */
interface Edited {
  touched: number[];
  insertedAt?: number;
  /** The edit was undone: the document is the file again. */
  undone?: boolean;
}

const topIndex = (doc: ProseNode, pos: number) => doc.resolve(pos).index(0);

/** Text nodes of prose: straight in a paragraph or heading, or in a bold or
 *  italic span there - not raw HTML, code, a definition or a wikilink. */
function proseTexts(doc: ProseNode) {
  const found: { pos: number; node: ProseNode }[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.isText) {
      const name = parent?.type.name;
      if (name === "paragraph" || name === "heading" || name === "md_span")
        found.push({ pos, node });
      return false;
    }
    return !node.type.spec.code;
  });
  return found;
}

/** Words in prose, as document ranges. */
function proseWords(doc: ProseNode) {
  const words: { from: number; to: number }[] = [];
  for (const { pos, node } of proseTexts(doc))
    for (const match of node.text!.matchAll(/\p{L}[\p{L}\p{N}]*/gu))
      words.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
      });
  return words;
}

/** Markdown pasted as text, which the editor reads as Markdown. */
const PASTED =
  "Pasted **bold**, a [link](https://example.com/p) and `code`.\n\n- one\n- two";

/** A paragraph as an assistant rewrites it, in Markdown. */
const REWRITTEN =
  "Rewritten with *emphasis*, a [link](https://example.com/ai) and $x^2$.";

/** End positions of the top-level paragraphs that hold text. */
function paragraphEnds(doc: ProseNode): { index: number; end: number }[] {
  const ends: { index: number; end: number }[] = [];
  let pos = 0;
  doc.forEach((node, _offset, index) => {
    // Prose: not a definition's line, whose rewriting cuts its references
    // loose, nor an HTML block, which takes in what is pasted onto its
    // last line (docs/dev/saving.md, "What a save can't keep").
    const raw = ["link_definition", "html"].includes(
      node.lastChild?.type.name ?? "",
    );
    if (node.type.name === "paragraph" && node.textContent.trim() && !raw)
      ends.push({ index, end: pos + node.nodeSize - 1 });
    pos += node.nodeSize;
  });
  return ends;
}

function makeEdit(
  view: EditorView,
  kind: EditKind,
  rand: () => number,
  ctx: Ctx,
): Edited | null {
  const { state } = view;
  const { doc, schema } = state;
  switch (kind) {
    case "type-word": {
      const spots: number[] = [];
      for (const { pos, node } of proseTexts(doc)) {
        const text = node.text!;
        for (let i = 0; i <= text.length; i++)
          if (i === 0 || i === text.length || text[i - 1] === " ")
            spots.push(pos + i);
      }
      if (!spots.length) return null;
      const at = pick(rand, spots);
      // A word and a space, on the side of it that has none.
      const before = doc.resolve(at).nodeBefore;
      const spaced = !before || (before.isText && before.text!.endsWith(" "));
      view.dispatch(state.tr.insertText(spaced ? "Textus " : " Textus", at));
      return { touched: [topIndex(doc, at)] };
    }
    case "delete-word": {
      const words = proseWords(doc);
      if (!words.length) return null;
      const { from, to } = pick(rand, words);
      // The word and a space after it, as a user deletes a word.
      const end = doc.textBetween(to, Math.min(to + 1, doc.content.size));
      view.dispatch(state.tr.delete(from, end === " " ? to + 1 : to));
      return { touched: [topIndex(doc, from)] };
    }
    case "toggle-bold": {
      const words = proseWords(doc);
      if (!words.length) return null;
      const { from, to } = pick(rand, words);
      view.dispatch(state.tr.setSelection(TextSelection.create(doc, from, to)));
      if (!toggleSpan(view, 2)) return null;
      return { touched: [topIndex(doc, from)] };
    }
    case "add-list-item": {
      // Enter at the end of an item's first paragraph.
      const ends: number[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== "list_item") return true;
        const first = node.firstChild;
        if (first?.type.name === "paragraph")
          ends.push(pos + 1 + first.nodeSize - 1);
        return true;
      });
      if (!ends.length) return null;
      const at = pick(rand, ends);
      view.dispatch(state.tr.setSelection(TextSelection.create(doc, at)));
      if (!splitListItem(schema.nodes.list_item)(view.state, view.dispatch))
        return null;
      view.dispatch(view.state.tr.insertText("New item"));
      return { touched: [topIndex(doc, at)] };
    }
    case "edit-table-cell": {
      const ends: number[] = [];
      doc.descendants((node, pos) => {
        if (
          node.type.name !== "table_cell" &&
          node.type.name !== "table_header"
        )
          return true;
        const first = node.firstChild;
        if (first?.isTextblock) ends.push(pos + 1 + first.nodeSize - 1);
        return false;
      });
      if (!ends.length) return null;
      const at = pick(rand, ends);
      view.dispatch(state.tr.insertText(" Textus", at));
      return { touched: [topIndex(doc, at)] };
    }
    case "insert-heading": {
      // Between two top-level blocks, never above front matter.
      const first = doc.firstChild?.type.name === "frontmatter" ? 1 : 0;
      const index = first + Math.floor(rand() * (doc.childCount + 1 - first));
      let pos = 0;
      for (let j = 0; j < index; j++) pos += doc.child(j).nodeSize;
      const level = 1 + Math.floor(rand() * 6);
      const heading = schema.nodes.heading.create(
        { level },
        schema.text("New heading"),
      );
      view.dispatch(state.tr.insert(pos, heading));
      return { touched: [], insertedAt: index };
    }
    case "paste-markdown": {
      // At the end of a paragraph, through the editor's own paste path.
      const ends = paragraphEnds(doc);
      if (!ends.length) return null;
      const { index, end } = pick(rand, ends);
      view.dispatch(state.tr.setSelection(TextSelection.create(doc, end)));
      // Plain text on the clipboard, as from a text editor.
      // (A plain Event: jsdom has no ClipboardEvent.)
      const event = new Event("paste") as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text/plain" ? PASTED : ""),
        },
      });
      if (!view.pasteText(PASTED, event)) return null;
      return { touched: [index], insertedAt: index + 1 };
    }
    case "replace-paragraph": {
      // A whole paragraph swapped for new Markdown, as an AI edit does.
      const ends = paragraphEnds(doc);
      if (!ends.length) return null;
      const { index, end } = pick(rand, ends);
      const block = doc.child(index);
      const from = end + 1 - block.nodeSize;
      const content = ctx.get(parserCtx)(REWRITTEN).content;
      view.dispatch(state.tr.replaceWith(from, end + 1, content));
      return { touched: [index] };
    }
    case "undo-edit": {
      // A word typed, then undone: the save must be the file again.
      const edited = makeEdit(view, "type-word", rand, ctx);
      if (!edited) return null;
      if (!undo(view.state, view.dispatch)) return null;
      return { touched: [], undone: true };
    }
  }
}

/** The document's content as text: each textblock's text on a line, and
 *  what an image, a footnote reference or a link points at. Formatting
 *  and the shape of lists and tables are left out, and so is what
 *  Markdown can't hold, or writes differently and reads the same:
 *
 *  - spaces at the end or start of a line of prose, which it drops;
 *  - line ends (shown as spaces) more than one at a time or at a
 *    paragraph's ends, a hard break at its end, and empty paragraphs;
 *  - spaces at a link's edges, which Milkdown writes outside the link;
 *  - a line end in inline code, which reads as a space;
 *  - two formulas side by side, written with a space between. */
export function contentText(doc: ProseNode): string {
  const lines: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "hr") lines.push("⟨hr⟩");
    if (!node.isTextblock) return true;
    const out: string[] = [];
    let link: string | null = null;
    const walk = (parent: ProseNode, inherited: string | null) => {
      let previous: ProseNode | null = null;
      parent.forEach((child) => {
        const href =
          child.marks.find((mark) => mark.type.name === "link")?.attrs.href ??
          inherited;
        if (child.isText) {
          const text =
            parent.type.name === "md_code_span"
              ? child.text!.replace(/\r?\n/g, " ")
              : child.text!;
          if (/\S/.test(text) || href !== null) {
            if (href !== link && href !== null) out.push(`⟨link ${href}⟩`);
            link = href;
          }
          out.push(text);
        } else if (child.type.name === "hardbreak")
          out.push(child.attrs.isInline ? "\n" : "⏎");
        else if (child.isLeaf) {
          const { src, alt, title, label } = child.attrs;
          const what = [src, alt, title, label].filter((v) => v != null);
          out.push(`⟨${child.type.name}${what.map((v) => ` ${v}`).join("")}⟩`);
        } else {
          if (inDollars(child) && previous && inDollars(previous))
            out.push(" ");
          walk(child, href);
        }
        previous = child;
      });
    };
    walk(node, null);
    const text = out.join("");
    if (node.type.spec.code) lines.push(text);
    else {
      const prose = text
        .replace(/(⟨link [^⟩]*⟩)( +)/g, "$2$1")
        .replace(/[ \t]*(\n|⏎)[ \t]*/g, "$1")
        .replace(/\n+/g, "\n")
        .replace(/^[ \t\n]+|[ \t\n⏎]+$/g, "");
      if (prose) lines.push(prose);
    }
    return false;
  });
  return lines.join("\n");
}

const inDollars = (node: ProseNode) =>
  node.type.name === "math_inline" &&
  !String(node.attrs.delimiter ?? "").startsWith("\\");

/** The kinds of the document's top-level blocks, in order. */
const blockKinds = (doc: ProseNode) => {
  const kinds: string[] = [];
  doc.forEach((node) => {
    // An empty paragraph is written as nothing.
    if (node.type.name !== "paragraph" || contentText(node) !== "")
      kinds.push(node.type.name);
  });
  return kinds.join(" ");
};

/** Where two texts first differ, with a little context. */
export function firstDifference(a: string, b: string, context = 60): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - context);
  const show = (s: string) =>
    JSON.stringify(s.slice(from, i + context)).slice(0, 4 * context);
  return `at ${i}: ${show(a)} vs ${show(b)}`;
}

/** What a tab reports for `doc` (useDocumentReporting.ts): the file's own
 *  text for the blocks that are as opened, or the whole document
 *  serialized when the blocks didn't pair. */
function saved(
  ctx: Ctx,
  opened: string,
  source: SourceBlocks | null,
  mountDoc: ProseNode,
  doc: ProseNode,
): string {
  if (source) return writePreservingSource(ctx, source, doc);
  const serializer = ctx.get(serializerCtx);
  const markdown = serializer(doc);
  return markdown === serializer(mountDoc) ? opened : markdown;
}

interface Opened {
  editor: Editor;
  text: string;
  source: SourceBlocks | null;
  mountDoc: ProseNode;
}

async function open(raw: string): Promise<Opened> {
  const text = toEditorText(raw);
  // Swatches on: drawn on load and redrawn around each edit, they must
  // never reach the saved text.
  const editor = await createTestEditor(text, { colorSwatches: "everywhere" });
  return editor.action((ctx) => {
    const mountDoc = ctx.get(editorViewCtx).state.doc;
    return {
      editor,
      text,
      mountDoc,
      source: readSourceBlocks(ctx, text, mountDoc),
    };
  });
}

/** Which top-level block of the opened doc each unit's text belongs to. */
function unitsByBlock(source: SourceBlocks): (number | null)[] {
  const byBlock: (number | null)[] = [];
  source.units.forEach((unit, u) => {
    for (let k = 0; k < unit.nodes.length; k++) byBlock.push(u);
  });
  return byBlock;
}

/** The top-level block kinds the serializer writes differently from the
 *  file, with a guess at why. For information: these are what an edited
 *  block is rewritten as. */
function serializeOnlyDifferences(
  ctx: Ctx,
  source: SourceBlocks,
): Record<string, number> {
  const serializer = ctx.get(serializerCtx);
  const schema = ctx.get(editorViewCtx).state.schema;
  const found: Record<string, number> = {};
  for (const unit of source.units) {
    if (unit.start === null || unit.end === null) continue;
    const before = source.text.slice(unit.start, unit.end);
    const doc = schema.topNodeType.create(null, unit.nodes);
    const after = serializer(doc).replace(/\n+$/, "");
    if (before === after) continue;
    const kind = `${unit.nodes[0].type.name}: ${whyDifferent(before, after)}`;
    found[kind] = (found[kind] ?? 0) + 1;
  }
  return found;
}

function whyDifferent(before: string, after: string): string {
  const squash = (s: string) => s.replace(/\s+/g, "");
  if (squash(before) === squash(after)) return "whitespace";
  if (before.replace(/\\(?=[^\n])/g, "") === after.replace(/\\(?=[^\n])/g, ""))
    return "escapes";
  if (before.replace(/[_*]/g, "") === after.replace(/[_*]/g, ""))
    return "emphasis or bullet markers";
  if (
    /^\s*\|/m.test(before) &&
    squash(before).replace(/[-:|]/g, "") === squash(after).replace(/[-:|]/g, "")
  )
    return "table padding";
  if (/\n[=-]+\s*$/.test(before) && /^#/.test(after)) return "setext heading";
  if (before.replace(/[+*-]/g, "") === after.replace(/[+*-]/g, ""))
    return "markers";
  return "other";
}

/**
 * Opens `raw`, saves it unedited, then makes each edit kind on a fresh load
 * and saves again, checking (a), (b) and (c). `seed` picks the edits;
 * `rounds` repeats each kind with the next seeds.
 */
export async function roundTripFile(
  raw: string,
  seed: number,
  rounds = 1,
): Promise<FileReport> {
  const report: FileReport = {
    failures: [],
    edits: {},
    unpaired: false,
    unkept: [],
    neighboursSerialized: 0,
    serializeOnly: {},
    blocks: 0,
  };
  const fail = (
    kind: FailureKind,
    edit: Failure["edit"],
    editSeed: number,
    detail: string,
  ) => report.failures.push({ kind, edit, seed: editSeed, detail });

  // Unedited: the file back byte for byte.
  let opened: Opened;
  try {
    opened = await open(raw);
  } catch (error) {
    fail("exception", "none", seed, String((error as Error)?.stack ?? error));
    return report;
  }
  try {
    opened.editor.action((ctx) => {
      const { text, source, mountDoc } = opened;
      const out = saved(ctx, text, source, mountDoc, mountDoc);
      if (out !== text)
        fail("unedited-changed", "none", seed, firstDifference(text, out));
      report.unpaired = source === null;
      if (source) {
        for (const unit of source.units)
          if (unit.start === null)
            report.unkept.push(
              ctx
                .get(serializerCtx)(mountDoc.type.create(null, unit.nodes))
                .slice(0, 80),
            );
        report.serializeOnly = serializeOnlyDifferences(ctx, source);
        report.blocks = source.units.length;
      }
    });
  } catch (error) {
    fail("exception", "none", seed, String((error as Error)?.stack ?? error));
  } finally {
    await opened.editor.destroy();
  }

  for (let round = 0; round < rounds; round++)
    for (let k = 0; k < EDIT_KINDS.length; k++) {
      const kind = EDIT_KINDS[k];
      const editSeed = (seed + round * EDIT_KINDS.length + k) >>> 0;
      await checkEdit(raw, kind, editSeed, report, fail);
    }
  return report;
}

/** For reproducing a failure: the opened text, what a save writes after
 *  edit `kind` with `seed` (the unedited save without one), and the whole
 *  document serialized. */
export async function saveAfterEdit(
  raw: string,
  kind: EditKind | "none",
  seed: number,
): Promise<{
  text: string;
  out: string;
  whole: string;
  doc: ProseNode;
} | null> {
  const opened = await open(raw);
  try {
    return opened.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (kind !== "none" && !makeEdit(view, kind, random(seed), ctx))
        return null;
      const { doc } = view.state;
      const { text, source, mountDoc } = opened;
      return {
        text,
        out: saved(ctx, text, source, mountDoc, doc),
        whole: ctx.get(serializerCtx)(doc),
        doc,
      };
    });
  } finally {
    await opened.editor.destroy();
  }
}

async function checkEdit(
  raw: string,
  kind: EditKind,
  seed: number,
  report: FileReport,
  fail: (
    kind: FailureKind,
    edit: EditKind,
    seed: number,
    detail: string,
  ) => void,
) {
  let opened: Opened | null = null;
  try {
    opened = await open(raw);
    const { text, source, mountDoc } = opened;
    opened.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const edited = makeEdit(view, kind, random(seed), ctx);
      if (!edited) return;
      report.edits[kind] = (report.edits[kind] ?? 0) + 1;
      const doc = view.state.doc;
      const out = saved(ctx, text, source, mountDoc, doc);
      if (edited.undone) {
        if (out !== text)
          fail("undo-changed", kind, seed, firstDifference(text, out));
        return;
      }

      // (a) The blocks the edit didn't touch, as the file had them, in
      // order. A kept block right beside the edit may be serialized when
      // the join with it wouldn't read back (saving.md, "Checking the
      // joins"); (b) checks that one.
      if (source) {
        const byBlock = unitsByBlock(source);
        const near = new Set<number | null>();
        for (const j of edited.touched) {
          near.add(byBlock[j - 1]).add(byBlock[j + 1]);
        }
        if (edited.insertedAt !== undefined)
          near
            .add(byBlock[edited.insertedAt - 1])
            .add(byBlock[edited.insertedAt]);
        const touched = new Set(edited.touched.map((j) => byBlock[j]));
        let cursor = 0;
        for (let u = 0; u < source.units.length; u++) {
          const unit = source.units[u];
          if (touched.has(u) || unit.start === null) continue;
          const own = text.slice(unit.start, unit.end!);
          // A kept block beside the edit may have been serialized, and
          // the same text further down mustn't count for it.
          if (near.has(u)) {
            const at = out.indexOf(own, cursor);
            if (at < 0) report.neighboursSerialized++;
            continue;
          }
          const at = out.indexOf(own, cursor);
          if (at >= 0) {
            cursor = at + own.length;
            continue;
          }
          fail(
            "untouched-changed",
            kind,
            seed,
            `block ${u} ${JSON.stringify(own.slice(0, 120))} is missing`,
          );
          break;
        }
      }

      // (b) The output reads back as the editor's text, and with as many
      // top-level blocks of the same kinds.
      const parse = ctx.get(parserCtx);
      const whole = ctx.get(serializerCtx)(doc);
      const reread = parse(out);
      const want = contentText(doc);
      const got = contentText(reread);
      const serializerAgrees = (check: (d: ProseNode) => boolean) =>
        out !== whole && check(parse(whole));
      if (got !== want)
        fail(
          serializerAgrees((d) => contentText(d) === want)
            ? "text-changed"
            : "text-changed-serializer",
          kind,
          seed,
          firstDifference(want, got),
        );
      else if (blockKinds(reread) !== blockKinds(doc))
        fail(
          serializerAgrees((d) => blockKinds(d) === blockKinds(doc))
            ? "blocks-changed"
            : "blocks-changed-serializer",
          kind,
          seed,
          firstDifference(blockKinds(doc), blockKinds(reread)),
        );
    });
  } catch (error) {
    fail("exception", kind, seed, String((error as Error)?.stack ?? error));
  } finally {
    await opened?.editor.destroy();
  }
}
