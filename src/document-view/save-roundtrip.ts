import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "./editor-test-harness";
import { toEditorText } from "../document/file-format";
import {
  readSourceBlocks,
  writePreservingSource,
  type SourceBlocks,
} from "../editor/markdown/source-preserving";
import {
  EDIT_KINDS,
  type EditKind,
  makeEdit,
  random,
} from "./save-roundtrip-edits";
export {
  EDIT_KINDS,
  type EditKind,
  random,
  hashString,
} from "./save-roundtrip-edits";
// Test-only: opens a file in the full editor, makes one seeded edit, and
// checks the save: (a) untouched blocks byte for byte, (b) the text reads
// back the same, (c) nothing threw. A failure reproduces from file and seed.

/** Why a check failed. `-serializer` kinds also fail with the whole document
 *  serialized, so they are the serializer's fault, not preservation's. */
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

/** The document's content as text, one textblock per line, with link, image
 *  and footnote targets. Leaves out formatting and whitespace Markdown can't
 *  hold or writes differently but reads the same. */
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

/** What a tab saves for `doc`: the file's own text for unchanged blocks, or
 *  the whole document serialized when the blocks didn't pair. */
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

      // (a) Untouched blocks, in order. A kept block beside the edit may be
      // serialized when the join wouldn't read back; (b) checks that one.
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
