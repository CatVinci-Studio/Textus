import { TextSelection } from "@milkdown/kit/prose/state";
import type { Transaction } from "@milkdown/kit/prose/state";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import {
  around,
  flatten,
  indexOf,
  lineEndIndex,
  lineStartIndex,
  linesRange,
  motion,
  posOf,
  selectionText,
  verticalMove,
} from "./editor-text";
import { scrollCaretTo } from "./editor-scroll";
import { findFlash } from "./editor-flash";

import {
  ACT_WITHIN_MS,
  NO_FLASH,
  held,
  inputKey,
  setCursorStyle,
  visualSelection,
} from "./editor-input-state";
/**
 * The editing actions a plugin holding the keyboard asks for (Vim's
 * motions, operators, flash), each taken only just after one of its keys.
 */

export type EditorOp =
  | {
      op: "move";
      unit: string;
      count?: number;
      /** Extend the selection from where it is anchored. */
      select?: boolean;
      /** Visual mode's: from where it started to where the cursor lands, both in. */
      visual?: boolean;
      char?: string;
      forward?: boolean;
      till?: boolean;
    }
  | { op: "selectLines"; count?: number }
  | { op: "held.visualStart" }
  | { op: "delete"; copy?: boolean }
  | { op: "deleteLines"; count?: number }
  | { op: "copy" }
  | { op: "copyLines"; count?: number }
  | { op: "deleteChars"; count?: number; back?: boolean; copy?: boolean }
  | { op: "insertText"; text: string }
  | { op: "pasteLines"; text: string; above?: boolean }
  | { op: "openLine"; above?: boolean }
  | { op: "replaceChar"; char: string }
  | { op: "collapse"; to?: "head" | "start" | "end" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "cursor"; style: "bar" | "block" }
  /** The caret's line to the middle, top or bottom of what shows: Vim's
   *  zz, zt and zb. */
  | { op: "scroll"; to: "center" | "top" | "bottom" }
  | { op: "flash"; query: string }
  | {
      op: "flashJump";
      label: string;
      /** Visual mode's: the selection runs on to the label's place. */
      select?: boolean;
      /** For an operator: from the caret to the label's place selected. */
      extend?: boolean;
    }
  | { op: "flashClear" };

export interface EditorOpResult {
  /** What a delete or copy took; a line copy ends with "\n". */
  text?: string;
  /** For flash: how many places it found. */
  labels?: number;
  /** For flash: the labels' letters, nearest the caret first. */
  letters?: string;
  /** Whether the selection is empty now. */
  empty: boolean;
}

const copyText = (text: string) =>
  void navigator.clipboard?.writeText(text).catch(() => {});

/** Runs one action in the editor that last had the keyboard; refused unless
 *  `plugin` holds the keys and one of its keys came just before. */
export function runEditorOp(plugin: string, action: EditorOp): EditorOpResult {
  if (!held.owner || held.owner.plugin !== plugin)
    throw new Error(
      "Only the plugin that has the keyboard acts in the editor.",
    );
  if (action.op === "cursor") {
    setCursorStyle(action.style);
    return { empty: true };
  }
  // Changing the cursor's look or clearing flash needs no key before it.
  const looks = action.op === "flashClear";
  if (!looks && Date.now() - held.owner.lastKeyAt > ACT_WITHIN_MS)
    throw new Error("Editor actions follow a key the user pressed.");
  const view = held.view;
  if (!view || view.isDestroyed) throw new Error("No editor.");
  const state = view.state;
  // Each command its own undo step, as in Vim.
  const dispatch = (tr: Transaction) =>
    view.dispatch((tr.docChanged ? closeHistory(tr) : tr).scrollIntoView());
  const result: EditorOpResult = { empty: true };
  const count = Math.max(
    1,
    Math.min(10_000, "count" in action ? (action.count ?? 1) : 1),
  );
  const vertical =
    action.op === "move" && (action.unit === "up" || action.unit === "down");
  if (!vertical && !looks) held.goalX = null;
  switch (action.op) {
    case "move": {
      const { anchor } = state.selection;
      const head =
        action.visual && held.visual ? held.visual.head : state.selection.head;
      let to = head;
      if (action.unit === "up" || action.unit === "down") {
        held.goalX ??= view.coordsAtPos(head, 1).left;
        for (let n = 0; n < count; n++)
          to = verticalMove(
            view,
            to,
            action.unit === "down" ? 1 : -1,
            held.goalX,
          );
      } else if (action.unit === "docStart") {
        to = TextSelection.atStart(state.doc).from;
      } else if (action.unit === "docEnd") {
        to = TextSelection.atEnd(state.doc).from;
      } else if (action.unit === "docLine") {
        // Line `count` of the document (Vim's 12G), at its first non-space character.
        const flat = flatten(state.doc, 0, state.doc.content.size);
        let i = 0;
        for (let n = 1; n < count; n++) {
          const next = flat.text.indexOf("\n", i);
          if (next < 0) break;
          i = next + 1;
        }
        to = posOf(flat, motion(flat, i, "lineFirstChar", {}));
      } else {
        const flat = around(state, head);
        let i = indexOf(flat, head);
        for (let n = 0; n < count; n++)
          i = motion(flat, i, action.unit, action);
        to = posOf(flat, i);
      }
      const $to = state.doc.resolve(
        Math.max(0, Math.min(to, state.doc.content.size)),
      );
      if (action.visual && held.visual) {
        held.visual.head = TextSelection.near($to).head;
        dispatch(
          state.tr.setSelection(
            visualSelection(state, held.visual!.anchor, held.visual!.head),
          ),
        );
        break;
      }
      held.visual = null;
      const sel = action.select
        ? TextSelection.between(state.doc.resolve(anchor), $to)
        : TextSelection.near($to);
      dispatch(state.tr.setSelection(sel));
      break;
    }
    case "held.visualStart": {
      const at = state.selection.head;
      held.visual = { anchor: at, head: at };
      dispatch(state.tr.setSelection(visualSelection(state, at, at)));
      break;
    }
    case "selectLines": {
      const lines = linesRange(state, count);
      dispatch(
        state.tr.setSelection(
          TextSelection.between(
            state.doc.resolve(lines.blocks ? lines.from + 1 : lines.from),
            state.doc.resolve(lines.blocks ? lines.to - 1 : lines.to),
          ),
        ),
      );
      break;
    }
    case "copy": {
      result.text = selectionText(state);
      copyText(result.text);
      break;
    }
    case "copyLines": {
      result.text = linesRange(state, count).text;
      copyText(result.text);
      break;
    }
    case "delete": {
      result.text = selectionText(state);
      if (action.copy !== false) copyText(result.text);
      if (!state.selection.empty) dispatch(state.tr.deleteSelection());
      break;
    }
    case "deleteLines": {
      const lines = linesRange(state, count);
      result.text = lines.text;
      copyText(lines.text);
      const tr = state.tr;
      // The whole document: one empty line is left, as Vim leaves one.
      if (
        lines.blocks &&
        lines.from === 0 &&
        lines.to === state.doc.content.size
      )
        tr.replaceWith(0, lines.to, state.schema.nodes.paragraph.create());
      else tr.delete(lines.from, lines.to);
      dispatch(tr);
      break;
    }
    case "deleteChars": {
      const { head } = state.selection;
      const flat = around(state, head, 2_000);
      const i = indexOf(flat, head);
      const lineStart = lineStartIndex(flat.text, i);
      const lineEnd = lineEndIndex(flat.text, i);
      const [a, b] = action.back
        ? [Math.max(lineStart, i - count), i]
        : [i, Math.min(lineEnd, i + count)];
      if (b > a) {
        const from = posOf(flat, a);
        const to = posOf(flat, b);
        result.text = state.doc.textBetween(from, to, "\n");
        if (action.copy !== false) copyText(result.text);
        dispatch(state.tr.delete(from, to));
      }
      break;
    }
    case "insertText": {
      dispatch(state.tr.insertText(action.text));
      break;
    }
    case "pasteLines": {
      const lines = action.text.replace(/\n$/, "").split("\n");
      const { $head } = state.selection;
      let depth = $head.depth;
      while (depth > 0 && !$head.node(depth).isTextblock) depth--;
      const paragraph = state.schema.nodes.paragraph;
      if (depth === 0 || !paragraph || $head.node(depth).type.spec.code) {
        dispatch(state.tr.insertText(action.text));
        break;
      }
      const at = action.above ? $head.before(depth) : $head.after(depth);
      const nodes = lines.map((line) =>
        paragraph.create(null, line ? state.schema.text(line) : null),
      );
      const tr = state.tr.insert(at, nodes);
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))));
      break;
    }
    case "openLine": {
      const { $head } = state.selection;
      let depth = $head.depth;
      while (depth > 0 && !$head.node(depth).isTextblock) depth--;
      if (depth === 0) break;
      if ($head.node(depth).type.spec.code) {
        const offset = $head.pos - $head.start(depth);
        const text = $head.node(depth).textContent;
        const at = action.above
          ? $head.start(depth) + text.lastIndexOf("\n", offset - 1) + 1
          : $head.start(depth) + lineEndIndex(text, offset);
        const tr = state.tr.insertText("\n", at);
        dispatch(
          tr.setSelection(
            TextSelection.create(tr.doc, action.above ? at : at + 1),
          ),
        );
        break;
      }
      const at = action.above ? $head.before(depth) : $head.after(depth);
      const type =
        $head.node(depth).type.name === "heading"
          ? state.schema.nodes.paragraph
          : $head.node(depth).type;
      const tr = state.tr.insert(at, type.create());
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)));
      break;
    }
    case "replaceChar": {
      const { head } = state.selection;
      const next = state.doc.textBetween(
        head,
        Math.min(head + 1, state.doc.content.size),
        "\n",
        "\n",
      );
      if (next && next !== "\n")
        dispatch(
          state.tr
            .insertText(action.char, head, head + 1)
            .setSelection(TextSelection.create(state.doc, head)),
        );
      break;
    }
    case "collapse": {
      held.visual = null;
      const { from, to, head } = state.selection;
      const at = action.to === "start" ? from : action.to === "end" ? to : head;
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
      break;
    }
    case "undo":
      undo(state, view.dispatch);
      break;
    case "redo":
      redo(state, view.dispatch);
      break;
    case "flash": {
      const found = findFlash(view, action.query);
      view.dispatch(
        state.tr.setMeta(inputKey, {
          labels: found.labels,
          matches: found.matches,
        }),
      );
      result.labels = found.count;
      result.letters = found.labels.map((l) => l.label).join("");
      break;
    }
    case "flashJump": {
      const labels = inputKey.getState(state)?.labels ?? [];
      const hit = labels.find((l) => l.label === action.label);
      const tr = state.tr.setMeta(inputKey, NO_FLASH);
      if (hit) {
        if (action.select && held.visual) {
          held.visual.head = hit.at;
          tr.setSelection(visualSelection(state, held.visual!.anchor, hit.at));
        } else if (action.extend) {
          const { head } = state.selection;
          tr.setSelection(
            TextSelection.create(
              state.doc,
              Math.min(head, hit.at),
              Math.max(head, hit.at),
            ),
          );
        } else {
          tr.setSelection(TextSelection.near(state.doc.resolve(hit.at)));
        }
      }
      dispatch(tr);
      result.labels = hit ? 1 : 0;
      break;
    }
    case "flashClear":
      view.dispatch(state.tr.setMeta(inputKey, NO_FLASH));
      break;
    case "scroll":
      scrollCaretTo(view, action.to);
      break;
  }
  result.empty = view.state.selection.empty;
  return result;
}
