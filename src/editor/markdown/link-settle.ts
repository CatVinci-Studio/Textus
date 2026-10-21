import {
  closeHistory,
  isHistoryTransaction,
} from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import type { Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { changedRanges } from "../changed-ranges";
import { typedImage, typedLink } from "./link-input-rule";

/**
 * A link or an image written out of order - `[]()` first, then its text
 * and its URL filled in, the URL pasted (a link of its own, paste-url.ts) -
 * becomes one once the caret is no longer inside it. The input rule only
 * sees a `)` being typed, and the bracket autopair only the caret moving
 * on past its own `)` (link-input-rule.ts's typedLinkEndingAt); filled in
 * from the inside, the brackets had neither, and stayed text around a
 * link of the URL alone.
 *
 * Only text typed in this editor is looked at - the ranges typing wrote,
 * kept until the caret leaves their block - so `\[a](b)` a file or a paste
 * escaped on purpose stays as it reads (a URL pasted into typed brackets
 * still counts: the brackets were typed). An undo or redo forgets
 * them: the link it took back would be made again at the next caret move.
 * Nor during an input method's composition, which any edit would end.
 */

const linkSettleKey = new PluginKey<[number, number][]>("link-settle");

const LINK = /(?<!!)\[([^[\]\n￼]+)\]\(([^()\s￼]+)\)/g;
const IMAGE = /!\[([^[\]\n￼]*)\]\(([^()\s￼]+)\)/g;

/** Typing, as far as it can be told from the steps: each puts in a few
 *  characters at most (a key, an autopair's pair) or takes some out. A
 *  paste - the app's own handlers mark it no differently - puts in more. */
function typed(tr: Transaction): boolean {
  return tr.steps.every(
    (step) => step instanceof ReplaceStep && step.slice.size <= 4,
  );
}

/** A textblock's text with one character per position: an inline node
 *  other than text stands as object replacement characters, as many as
 *  its size, which neither pattern takes. */
function blockText(block: ProseNode): string {
  let text = "";
  block.forEach((child) => {
    text += child.isText ? child.text! : "￼".repeat(child.nodeSize);
  });
  return text;
}

/** The first link or image written out in the edited ranges that the
 *  caret is not inside, made one. */
function settle(state: EditorState, ranges: [number, number][]) {
  const { selection, doc } = state;
  const seen = new Set<number>();
  for (const [from] of ranges) {
    if (from < 0 || from > doc.content.size) continue;
    const $from = doc.resolve(from);
    const block = $from.parent;
    if (!block.isTextblock || block.type.spec.code) continue;
    const start = $from.start();
    if (seen.has(start)) continue;
    seen.add(start);
    const text = blockText(block);
    for (const [pattern, make] of [
      [IMAGE, typedImage],
      [LINK, typedLink],
    ] as const) {
      for (const match of text.matchAll(pattern)) {
        const at = start + match.index!;
        const end = at + match[0].length;
        if (selection.from > at && selection.from < end) continue;
        if (!ranges.some(([a, b]) => b >= at && a <= end)) continue;
        const tr = make(state, match, at, end);
        if (tr) return tr;
      }
    }
  }
  return null;
}

export const linkSettlePlugin = $prose(
  () =>
    new Plugin<[number, number][]>({
      key: linkSettleKey,
      state: {
        init: () => [],
        apply(tr, ranges, _old, state) {
          if (isHistoryTransaction(tr)) return [];
          let next = ranges.map(
            ([a, b]) =>
              [tr.mapping.map(a, -1), tr.mapping.map(b, 1)] as [number, number],
          );
          // Typed, not pasted or dropped: pasted Markdown already reads as
          // it was written, escapes and all.
          if (tr.docChanged && !tr.getMeta(linkSettleKey) && typed(tr))
            next.push(...changedRanges(tr));
          // A range is kept while the caret is in its block: one the caret
          // has left was looked at as it left.
          const $caret = state.selection.$from;
          next = next.filter(
            ([a]) =>
              a >= 0 &&
              a <= state.doc.content.size &&
              state.doc.resolve(a).start() === $caret.start(),
          );
          return next;
        },
      },
      appendTransaction(transactions, oldState, state) {
        if (
          transactions.some(
            (tr) => isHistoryTransaction(tr) || tr.getMeta("composition"),
          )
        )
          return null;
        if (!transactions.some((tr) => tr.docChanged || tr.selectionSet))
          return null;
        // The ranges as they were before the caret moved, mapped onto the
        // new document: those of a block just left are looked at now.
        const before = linkSettleKey.getState(oldState) ?? [];
        const mapped = before.map(([a, b]) => {
          let from = a;
          let to = b;
          for (const tr of transactions) {
            from = tr.mapping.map(from, -1);
            to = tr.mapping.map(to, 1);
          }
          return [from, to] as [number, number];
        });
        const ranges = [...mapped, ...(linkSettleKey.getState(state) ?? [])];
        if (ranges.length === 0) return null;
        const tr = settle(state, ranges);
        // Its own undo step: one undo takes back the link, not the URL
        // pasted just before it as well.
        return tr ? closeHistory(tr.setMeta(linkSettleKey, true)) : null;
      },
    }),
);
