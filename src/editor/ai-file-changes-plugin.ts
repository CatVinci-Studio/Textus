import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { serializeBlocks, type MarkdownBlock } from "../ai/doc-markdown";
import {
  changesSettled,
  onChangedFiles,
  textBeforeChanges,
} from "../ai/chat/file-changes";
import { currentStrings } from "../i18n/current";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import "./ai-file-changes.css";

/**
 * A file Textus AI changed from General mode opens showing where: each
 * block it changed or added barred in the margin, a line where it removed
 * some, each with a button that puts that place back as it was.
 */

const key = new PluginKey<DecorationSet>("ai-file-changes");
/** Past this many block pairs, no diff: too slow for a keystroke. */
const MOST_PAIRS = 4_000_000;

/** A place that differs: the document's blocks [from, to) were the earlier
 *  text's [baseFrom, baseTo). */
export interface Hunk {
  from: number;
  to: number;
  baseFrom: number;
  baseTo: number;
}

/** Where `now` differs from `base`, block by block (longest common run). */
export function blockHunks(
  base: readonly string[],
  now: readonly string[],
): Hunk[] {
  const n = base.length;
  const m = now.length;
  // keep[i][j]: the longest common run of base[i..] and now[j..].
  const keep = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      keep[i][j] =
        base[i] === now[j]
          ? keep[i + 1][j + 1] + 1
          : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push({ ...open, baseTo: i, to: j });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === now[j]) {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { from: j, to: j, baseFrom: i, baseTo: i };
    if (j < m && (i === n || keep[i][j + 1] >= keep[i + 1][j])) j++;
    else i++;
  }
  close();
  return hunks;
}

interface Review {
  blocks: MarkdownBlock[];
  baseDoc: ProseNode;
  baseBlocks: MarkdownBlock[];
  hunks: Hunk[];
}

function reviewOf(ctx: Ctx, doc: ProseNode, base: string): Review | null {
  const baseDoc = parseMarkdownSource(ctx, base);
  if (!baseDoc || typeof baseDoc === "string") return null;
  const blocks = serializeBlocks(ctx, doc);
  const baseBlocks = serializeBlocks(ctx, baseDoc);
  if (blocks.length * baseBlocks.length > MOST_PAIRS) return null;
  const hunks = blockHunks(
    baseBlocks.map((b) => b.markdown),
    blocks.map((b) => b.markdown),
  );
  return { blocks, baseDoc, baseBlocks, hunks };
}

/** Puts the hunk's place back as the earlier text had it. */
function revert(view: EditorView, review: Review, hunk: Hunk) {
  const { blocks, baseDoc, baseBlocks } = review;
  const from =
    hunk.from < blocks.length
      ? blocks[hunk.from].from
      : view.state.doc.content.size;
  const to = hunk.to > hunk.from ? blocks[hunk.to - 1].to : from;
  const content =
    hunk.baseTo > hunk.baseFrom
      ? baseDoc.slice(
          baseBlocks[hunk.baseFrom].from,
          baseBlocks[hunk.baseTo - 1].to,
        ).content
      : null;
  const tr = content
    ? view.state.tr.replaceWith(from, to, content)
    : view.state.tr.delete(from, to);
  view.dispatch(tr);
}

function decorate(view: EditorView, review: Review): DecorationSet {
  const { blocks } = review;
  const label = currentStrings().aiChangeRevert;
  const decorations: Decoration[] = [];
  for (const hunk of review.hunks) {
    const at =
      hunk.from < blocks.length
        ? blocks[hunk.from].from
        : view.state.doc.content.size;
    const removed = hunk.to === hunk.from;
    decorations.push(
      Decoration.widget(
        at,
        () => {
          const mark = document.createElement("div");
          mark.className = `ai-change-mark${removed ? " ai-change-removed" : ""}`;
          mark.contentEditable = "false";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "tx-button small";
          button.textContent = label;
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", () => revert(view, review, hunk));
          mark.append(button);
          return mark;
        },
        { side: -1, key: `${hunk.from}:${hunk.baseFrom}:${removed}` },
      ),
    );
    for (const block of blocks.slice(hunk.from, hunk.to))
      decorations.push(
        Decoration.node(block.from, block.to, { class: "ai-changed-block" }),
      );
  }
  return DecorationSet.create(view.state.doc, decorations);
}

export function createAiFileChangesPlugin(docPath: () => string | null) {
  return $prose(
    (ctx) =>
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) =>
            (tr.getMeta(key) as DecorationSet | undefined) ??
            set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let frame = 0;
          let shown = false;
          const check = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              const path = docPath();
              const base = path ? textBeforeChanges(path) : undefined;
              if (base === undefined) {
                if (shown)
                  view.dispatch(
                    view.state.tr.setMeta(key, DecorationSet.empty),
                  );
                shown = false;
                return;
              }
              const review = reviewOf(ctx, view.state.doc, base ?? "");
              if (!review) return;
              // Every place put back: nothing of Textus AI's left here.
              if (review.hunks.length === 0 && path) changesSettled(path);
              view.dispatch(view.state.tr.setMeta(key, decorate(view, review)));
              shown = true;
            });
          };
          check();
          const unlisten = onChangedFiles(check);
          return {
            update: (v, prev) => {
              if (v.state.doc !== prev.doc) check();
            },
            destroy: () => {
              cancelAnimationFrame(frame);
              unlisten();
            },
          };
        },
      }),
  );
}
