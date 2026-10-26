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
 * A bare URL typed out becomes a link once the caret has gone past it, as
 * GFM would read it on reopening; so does a link or image filled in out of
 * order (`[]()` first), once the caret leaves it, since neither the input
 * rule nor the autopair sees that. Only text typed in this editor counts,
 * so a deliberately escaped `\[a](b)` stays; undo, redo and compositions
 * are left alone.
 */

const linkSettleKey = new PluginKey<[number, number][]>("link-settle");

const LINK = /(?<!!)\[([^[\]\n\ufffc]+)\]\(([^()\s\ufffc]+)\)/g;
/** A bare URL as GFM reads one: at the start or after a space (or `*`, `_`,
 *  `~`, `(`), `http(s)://` or `www.`. */
const BARE_URL = /(?<=^|[\s*_~(])(?:https?:\/\/|www\.)[^\s<>\ufffc]+/gi;

/** A bare URL without the punctuation GFM leaves after it. */
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (!last) return "";
    if (".,:;!?\"'".includes(last)) end--;
    else if (last === ")") {
      const inside = url.slice(0, end);
      if (inside.split("(").length < inside.split(")").length) end--;
      else return inside;
    } else return url.slice(0, end);
  }
}

/** `url` at start..end as an autolink, the way a bare URL in a file reads. */
function bareLink(state: EditorState, url: string, start: number, end: number) {
  const link = state.schema.marks.link;
  if (!link || state.doc.rangeHasMark(start, end, link)) return null;
  const href = /^www\./i.test(url) ? `http://${url}` : url;
  return state.tr.addMark(
    start,
    end,
    link.create({ href, syntax: "autolink" }),
  );
}
const IMAGE = /!\[([^[\]\n\ufffc]*)\]\(([^()\s\ufffc]+)\)/g;

/** Typing, as far as the steps tell: each puts in a few characters at most
 *  or takes some out. A paste puts in more. */
function typed(tr: Transaction): boolean {
  return tr.steps.every(
    (step) => step instanceof ReplaceStep && step.slice.size <= 4,
  );
}

/** A textblock's text with one character per position: a non-text inline
 *  node stands as object replacement characters, which neither pattern
 *  takes. */
function blockText(block: ProseNode): string {
  let text = "";
  block.forEach((child) => {
    text += child.isText ? child.text! : "\ufffc".repeat(child.nodeSize);
  });
  return text;
}

/** The first link or image written out in the edited ranges that the caret
 *  is not inside, made one. */
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
    const edited = (at: number, end: number) =>
      ranges.some(([a, b]) => b >= at && a <= end);
    for (const [pattern, make] of [
      [IMAGE, typedImage],
      [LINK, typedLink],
    ] as const) {
      for (const match of text.matchAll(pattern)) {
        const at = start + match.index!;
        const end = at + match[0].length;
        if (selection.from > at && selection.from < end) continue;
        if (!edited(at, end)) continue;
        const tr = make(state, match, at, end);
        if (tr) return tr;
      }
    }
    // A bare URL once the caret has gone past it, not while it may still be
    // typed: "https://a." is one the writer is still in.
    for (const match of text.matchAll(BARE_URL)) {
      const url = trimUrl(match[0]);
      const at = start + match.index!;
      const end = at + url.length;
      const typing = at + match[0].length;
      if (!url || (selection.from > at && selection.from <= typing)) continue;
      if (!edited(at, end)) continue;
      const tr = bareLink(state, url, at, end);
      if (tr) return tr;
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
          // Typed only: pasted Markdown already reads as it was written.
          if (tr.docChanged && !tr.getMeta(linkSettleKey) && typed(tr))
            next.push(...changedRanges(tr));
          // A range is kept while the caret is in its block; one it left was looked
          // at as it left.
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
        // The ranges before the caret moved, mapped onto the new document: those of
        // a block just left are looked at now.
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
        // Its own undo step: one undo takes back the link, not the pasted URL too.
        return tr ? closeHistory(tr.setMeta(linkSettleKey, true)) : null;
      },
    }),
);
