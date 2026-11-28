import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { HeadingFoldMarks } from "./heading-fold-marks";
import { flip } from "../../engine/motion/flip";
import { movingBlocks } from "../blocks/block-lift";
import { keepInList, uiList } from "../../storage/ui-state";
import { modIsMeta } from "../../platform/os";
import "./block-fold.css";

/**
 * A heading's section folded away under it, as drawn blocks fold: a caret
 * in the margin on its left, outside the text - with ⋮⋮ on hover
 * (block-handles-plugin.ts), and on its own while folded. Only what is
 * drawn changes; the text, its saving and its export are the same. A caret
 * that lands in a folded section (a search, the outline) opens it. Folds
 * are kept on this machine by the document and the heading.
 */

/** Folds remembered at most, with the drawn blocks'; the oldest goes. */
const KEPT = 300;

interface Folds {
  /** The folded headings' positions, top-level. */
  at: readonly number[];
  decorations: DecorationSet;
}

const foldKey = new PluginKey<Folds>("heading-fold");

/** A top-level heading's text and level, as its key in the store reads. */
const headingName = (node: ProseNode) =>
  `${node.attrs.level as number}:${node.textContent.trim()}`;

const keyOf = (path: string, node: ProseNode) =>
  `${path}\n#${headingName(node)}`;

interface Section {
  heading: number;
  level: number;
  /** Where the folded part runs: after the heading, up to the next heading
   *  as high or higher. */
  from: number;
  to: number;
}

/** The section under each top-level heading. */
function sections(doc: ProseNode): Section[] {
  const out: Section[] = [];
  const open: Section[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level as number;
    while (open.length && open[open.length - 1]!.level >= level)
      open.pop()!.to = offset;
    const section = {
      heading: offset,
      level,
      from: offset + node.nodeSize,
      to: doc.content.size,
    };
    open.push(section);
    out.push(section);
  });
  return out;
}

type Toggle = (view: EditorView, heading: number) => void;

function decorate(doc: ProseNode, at: readonly number[]): DecorationSet {
  const folded = new Set(at);
  const decorations: Decoration[] = [];
  for (const section of sections(doc)) {
    if (!folded.has(section.heading)) continue;
    const heading = doc.nodeAt(section.heading)!;
    decorations.push(
      Decoration.node(section.heading, section.heading + heading.nodeSize, {
        "data-folded": "",
      }),
    );
    doc.nodesBetween(section.from, section.to, (node, pos) => {
      if (pos >= section.from && pos + node.nodeSize <= section.to)
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "heading-folded-away",
          }),
        );
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** The folded headings still standing after a change, top-level. */
function stillHeadings(doc: ProseNode, at: readonly number[]): number[] {
  return at.filter((pos) => {
    const node = doc.nodeAt(pos);
    return node?.type.name === "heading" && doc.resolve(pos).depth === 0;
  });
}

/** The folds a caret at `pos` lies under: they open. */
function hiding(state: EditorState, at: readonly number[], pos: number) {
  const folded = new Set(at);
  return sections(state.doc).filter(
    (s) => folded.has(s.heading) && pos > s.from && pos < s.to,
  );
}

/** The section the caret is in: its heading, or the nearest one above it at
 *  the top level. */
function sectionAt(state: EditorState): Section | undefined {
  const pos = state.selection.from;
  return sections(state.doc)
    .filter((s) => pos > s.heading && pos <= s.to)
    .pop();
}

/** The fold keys (foldCombos) by physical key: Option or Shift changes
 *  the character. True folds, false opens, null is another key. */
function foldKeyOf(e: KeyboardEvent): boolean | null {
  if (e.getModifierState?.("AltGraph")) return null;
  const mac = modIsMeta();
  const mod = mac ? e.metaKey : e.ctrlKey;
  const second = mac ? e.altKey && !e.shiftKey : e.shiftKey && !e.altKey;
  if (!mod || !second) return null;
  if (e.code === "BracketLeft") return true;
  if (e.code === "BracketRight") return false;
  return null;
}

export const createHeadingFoldPlugin = (path: () => string | null) =>
  $prose(() => {
    const remember = (node: ProseNode, on: boolean) => {
      const where = path();
      if (where)
        keepInList("foldedBlocks", keyOf(where, node), on, { max: KEPT });
    };
    const toggle: Toggle = (view, pos) => {
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== "heading") return;
      const folding = !foldKey.getState(view.state)?.at.includes(pos);
      remember(node, folding);
      const tr = view.state.tr
        .setMeta(foldKey, [pos])
        .setMeta("addToHistory", false);
      // A caret in what folds away goes to the heading's end.
      const section = sections(view.state.doc).find((x) => x.heading === pos);
      const caret = view.state.selection.from;
      if (folding && section && caret > section.from && caret < section.to)
        tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize - 1));
      // The blocks below glide up into the folded section's room, or down
      // as it opens and its blocks come in under the heading; drawn at
      // once, they jumped by its height.
      flip(movingBlocks(view), () => view.dispatch(tr), {
        duration: "--dur-base",
        easing: "--ease-out",
        arrived: () => movingBlocks(view),
      });
    };
    return new Plugin<Folds>({
      key: foldKey,
      toggle,
      view: (view) => new HeadingFoldMarks(view, foldedAt, toggle),
      state: {
        init: (_config, state) => {
          const where = path();
          const kept = where ? new Set(uiList("foldedBlocks")) : new Set();
          const at = where
            ? sections(state.doc)
                .map((s) => s.heading)
                .filter((pos) => kept.has(keyOf(where, state.doc.nodeAt(pos)!)))
            : [];
          return { at, decorations: decorate(state.doc, at) };
        },
        apply: (tr, folds, _old, state) => {
          const toggled = tr.getMeta(foldKey) as number[] | undefined;
          if (!tr.docChanged && !toggled) return folds;
          let at = tr.docChanged
            ? stillHeadings(
                state.doc,
                folds.at.map((pos) => tr.mapping.map(pos)),
              )
            : folds.at;
          if (toggled)
            for (const pos of toggled)
              at = at.includes(pos)
                ? at.filter((p) => p !== pos)
                : [...at, pos];
          return { at, decorations: decorate(state.doc, at) };
        },
      },
      // A caret in a folded section (a jump, a search) opens it.
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
        const folds = foldKey.getState(state);
        if (!folds?.at.length) return null;
        const open = hiding(state, folds.at, state.selection.from);
        if (!open.length) return null;
        for (const s of open) remember(state.doc.nodeAt(s.heading)!, false);
        return state.tr.setMeta(
          foldKey,
          open.map((s) => s.heading),
        );
      },
      props: {
        decorations: (state) => foldKey.getState(state)?.decorations,
        handleKeyDown: (view, event) => {
          const folding = foldKeyOf(event);
          if (folding === null) return false;
          const section = sectionAt(view.state);
          if (!section) return false;
          const on = foldKey.getState(view.state)?.at.includes(section.heading);
          if (on !== folding) toggle(view, section.heading);
          return true;
        },
      },
    });
  });

/** The folded headings' positions in `state`, top-level. */
function foldedAt(state: EditorState): readonly number[] {
  return foldKey.getState(state)?.at ?? [];
}

/** The fold of the top-level heading at `pos` in `view`, if it has one. */
export function headingFold(
  view: EditorView,
  pos: number,
): { folded: boolean; toggle: () => void } | null {
  const plugin = foldKey.get(view.state);
  const node = view.state.doc.nodeAt(pos);
  if (!plugin || node?.type.name !== "heading") return null;
  if (view.state.doc.resolve(pos).depth !== 0) return null;
  const toggle = plugin.spec.toggle as Toggle;
  return {
    folded: foldedAt(view.state).includes(pos),
    toggle: () => toggle(view, pos),
  };
}
