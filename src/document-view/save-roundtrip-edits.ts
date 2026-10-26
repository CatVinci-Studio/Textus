import { parserCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { splitListItem } from "@milkdown/kit/prose/schema-list";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { toggleSpan } from "../editor/marks/span-commands";

/**
 * Test-only: the edits the save round trip makes, each the way the app
 * makes it, picked by a seeded random generator.
 */

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

/** A file's seed for random(), from its name. */
export { fnv1a as hashString } from "../utils/hash";

export const pick = <T>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)];

/** Which top-level blocks an edit touched (indexes in the opened doc),
 *  and where a new block went in. Null: nowhere to make this edit. */
export interface Edited {
  touched: number[];
  insertedAt?: number;
  /** The edit was undone: the document is the file again. */
  undone?: boolean;
}

export const topIndex = (doc: ProseNode, pos: number) =>
  doc.resolve(pos).index(0);

/** Text nodes of prose: straight in a paragraph or heading, or in a bold or
 *  italic span there - not raw HTML, code, a definition or a wikilink. */
export function proseTexts(doc: ProseNode) {
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
export function proseWords(doc: ProseNode) {
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
export const PASTED =
  "Pasted **bold**, a [link](https://example.com/p) and `code`.\n\n- one\n- two";

/** A paragraph as an assistant rewrites it, in Markdown. */
export const REWRITTEN =
  "Rewritten with *emphasis*, a [link](https://example.com/ai) and $x^2$.";

/** End positions of the top-level paragraphs that hold text. */
export function paragraphEnds(
  doc: ProseNode,
): { index: number; end: number }[] {
  const ends: { index: number; end: number }[] = [];
  let pos = 0;
  doc.forEach((node, _offset, index) => {
    // Not a definition's line, whose rewrite cuts its references loose, nor
    // an HTML block, which takes in what is pasted onto its last line.
    const raw = ["link_definition", "html"].includes(
      node.lastChild?.type.name ?? "",
    );
    if (node.type.name === "paragraph" && node.textContent.trim() && !raw)
      ends.push({ index, end: pos + node.nodeSize - 1 });
    pos += node.nodeSize;
  });
  return ends;
}

export function makeEdit(
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
      // Plain text on the clipboard. A plain Event: jsdom has no
      // ClipboardEvent.
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
