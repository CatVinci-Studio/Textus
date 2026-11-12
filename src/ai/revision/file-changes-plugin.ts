import { widgetButton } from "../../editor/widget-button";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  serializeBlocks,
  type MarkdownBlock,
} from "../../editor/markdown/doc-markdown";
import {
  changesSettled,
  onChangedFiles,
  textBeforeChanges,
} from "../chat/file-changes";
import { currentStrings } from "../../i18n/current";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import "./file-changes.css";
import { blockHunks, type Hunk } from "./block-hunks";
import { metaDecorations } from "../../editor/meta-decorations";

/**
 * A file Textus AI changed from General mode opens showing where: each
 * block it changed or added barred in the margin, a line where it removed
 * some, each with a button that puts that place back as it was.
 */

const key = new PluginKey<DecorationSet>("ai-file-changes");
/** Past this many block pairs, no diff: too slow for a keystroke. */
const MOST_PAIRS = 4_000_000;

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

/** The hunk as the document is now: the widget's button outlives the
 *  review it was drawn from, and typing moves what it points at. */
function hunkNow(now: Review | null, hunk: Hunk): Hunk | null {
  return (
    now?.hunks.find(
      (h) =>
        h.baseFrom === hunk.baseFrom &&
        h.baseTo === hunk.baseTo &&
        h.to - h.from === hunk.to - hunk.from,
    ) ?? null
  );
}

function decorate(
  view: EditorView,
  review: Review,
  current: () => Review | null,
): DecorationSet {
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
          mark.append(
            widgetButton("tx-reveal tx-button small", label, () => {
              const now = current();
              const place = hunkNow(now, hunk);
              if (now && place) revert(view, now, place);
            }),
          );
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
        state: metaDecorations(key),
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let frame = 0;
          let shown = false;
          const current = () => {
            const path = docPath();
            const base = path ? textBeforeChanges(path) : undefined;
            return base === undefined
              ? null
              : reviewOf(ctx, view.state.doc, base ?? "");
          };
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
              view.dispatch(
                view.state.tr.setMeta(key, decorate(view, review, current)),
              );
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
