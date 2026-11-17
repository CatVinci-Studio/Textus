import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { animate, motionAllowed } from "../../engine/motion/motion";
import { isTableCell } from "./table-pos";
import { tableSize } from "./table-edits";
import { play } from "../../engine/motion/flip";

/**
 * A row or column added to a table opens up: the cells that make room
 * slide to their new places and the new ones fade in, on transforms and
 * opacity alone. Measured before the table is drawn anew, played after.
 */

const key = new PluginKey("table-growth");

/** More cells than this and the table just changes. */
const MOST_CELLS = 400;

interface Growth {
  /** Each old cell's box and its place in the new document. */
  moved: { to: number; was: DOMRect }[];
  /** The table's place in the new document. */
  table: number;
}

/** The tables the transactions touched, by their place before them. */
function touchedTables(trs: readonly Transaction[], doc: ProseNode) {
  const found = new Set<number>();
  for (const tr of trs)
    for (const step of tr.steps)
      step.getMap().forEach((from) => {
        const $at = doc.resolve(Math.min(from, doc.content.size));
        for (let d = $at.depth; d > 0; d--)
          if ($at.node(d).type.spec.tableRole === "table")
            found.add($at.before(d));
      });
  return found;
}

/** The cells of the table at `pos`, with their places. */
function cellsOf(table: ProseNode, pos: number) {
  const cells: { pos: number }[] = [];
  table.descendants((node, at) => {
    if (isTableCell(node)) cells.push({ pos: pos + 1 + at });
    return !isTableCell(node);
  });
  return cells;
}

function measure(
  view: EditorView,
  trs: readonly Transaction[],
  old: EditorState,
  now: EditorState,
): Growth[] {
  if (view.state.doc !== old.doc || !motionAllowed()) return [];
  const map = (pos: number) => trs.reduce((at, tr) => tr.mapping.map(at), pos);
  const grown: Growth[] = [];
  for (const pos of touchedTables(trs, old.doc)) {
    const before = old.doc.nodeAt(pos);
    const table = map(pos);
    const after = now.doc.nodeAt(table);
    if (!before || after?.type.spec.tableRole !== "table") continue;
    const was = tableSize(before);
    const is = tableSize(after);
    if (is.rows < was.rows || is.cols < was.cols) continue;
    if (is.rows === was.rows && is.cols === was.cols) continue;
    const cells = cellsOf(before, pos);
    if (cells.length > MOST_CELLS) continue;
    const moved = cells.flatMap(({ pos: at }) => {
      const dom = view.nodeDOM(at);
      return dom instanceof HTMLElement
        ? [{ to: map(at), was: dom.getBoundingClientRect() }]
        : [];
    });
    grown.push({ moved, table });
  }
  return grown;
}

function opened(view: EditorView, { moved, table }: Growth) {
  const node = view.state.doc.nodeAt(table);
  if (!node) return;
  // The cells there before slide from where they were (FLIP)...
  const before = new Map<Element, DOMRect>();
  for (const { to, was } of moved) {
    const el = view.nodeDOM(to);
    if (el instanceof HTMLElement) before.set(el, was);
  }
  play(before);
  const old = new Set(before.keys());
  // ...and the new ones fade in.
  for (const { pos } of cellsOf(node, table)) {
    const el = view.nodeDOM(pos);
    if (el instanceof HTMLElement && !old.has(el))
      animate(el, [{ opacity: 0 }, { opacity: 1 }], {
        duration: "--dur-settle",
        easing: "--ease-settle",
      });
  }
}

/** Rows and columns added to a table open up instead of appearing. */
export const tableGrowth = $prose(() => {
  let view: EditorView | null = null;
  let pending: Growth[] = [];
  return new Plugin({
    key,
    // Before the table is drawn anew: the old cells are still there.
    appendTransaction(trs, old, now) {
      if (view && trs.some((tr) => tr.docChanged))
        pending = measure(view, trs, old, now);
      return null;
    },
    view(editor) {
      view = editor;
      return {
        update(v) {
          const grown = pending;
          pending = [];
          for (const growth of grown) opened(v, growth);
        },
        destroy() {
          view = null;
        },
      };
    },
  });
});
