import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import { $prose } from "@milkdown/kit/utils";
import { isMacPlatform } from "../../platform/os";
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
import { findFlash, type FlashLabel } from "./editor-flash";
import { keyName } from "./editor-keys";

/**
 * A plugin that takes over the editor's keyboard (permission
 * `editor.input`): the Vim plugin's normal mode, Emacs keys. The plugin
 * says which keys it wants - every key, or a few - and each such key the
 * editor gets is held back and handed to the plugin instead, there and
 * then (a sandboxed plugin can't answer a keydown in time to stop it, so
 * the editor decides, from what the plugin said beforehand). The plugin
 * answers with editing actions (EditorOp below): moving the caret by
 * words and lines, deleting, copying, pasting, undoing - done in the
 * editor as typing is, undoable, never a proposal. They are taken only
 * just after a key the plugin was handed: a plugin can't change the
 * document unprompted. One plugin has the keyboard at a time.
 */

export interface KeyCapture {
  /** "all": every key but the app's shortcuts (⌘ on a Mac, Ctrl
   *  elsewhere - unless named in `keys`) and an input method's; "some":
   *  only `keys`. */
  mode: "all" | "some";
  keys: string[];
}

interface Owner {
  plugin: string;
  capture: KeyCapture;
  deliver: (key: string) => void;
  lastKeyAt: number;
}

let owner: Owner | null = null;
let lastView: EditorView | null = null;
/** Visual mode's ends, as characters (Vim's): the one it started on and
 *  the one the cursor is on - both inside the selection, whichever way it
 *  runs. */
let visual: { anchor: number; head: number } | null = null;
/** The column moves up and down keep (Vim's curswant): set by the first
 *  of them, dropped by anything else. */
let goalX: number | null = null;

/** The selection from character `anchor` to character `head`, both in. */
function visualSelection(state: EditorState, anchor: number, head: number) {
  const doc = state.doc;
  const after = (p: number) => {
    const $p = doc.resolve(p);
    return Math.min(p + 1, $p.parent.isTextblock ? $p.end() : p);
  };
  return head >= anchor
    ? TextSelection.create(doc, anchor, after(head))
    : TextSelection.create(doc, after(anchor), head);
}

/** Gives `plugin` the keys `capture` names, delivered to `deliver`; null
 *  gives the keyboard back. */
export function setKeyCapture(
  plugin: string,
  capture: KeyCapture | null,
  deliver: (key: string) => void,
): void {
  if (!capture) {
    if (owner?.plugin === plugin) owner = null;
    setCursorStyle("bar");
    return;
  }
  owner = { plugin, capture, deliver, lastKeyAt: owner?.lastKeyAt ?? 0 };
}

/** Lets go of whatever `plugin` held: it stopped. */
export function releaseKeys(plugin: string): void {
  if (owner?.plugin !== plugin) return;
  owner = null;
  setCursorStyle("bar");
  clearFlash();
}

/** How long after a key it was handed a plugin's actions are taken. */
const ACT_WITHIN_MS = 3000;

function captures(event: KeyboardEvent, capture: KeyCapture): string | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key))
    return null;
  const name = keyName(event);
  if (capture.mode === "some") return capture.keys.includes(name) ? name : null;
  // The app's shortcuts stay its own (save, find, new tab), unless named:
  // ⌘ on a Mac, Ctrl elsewhere.
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey || event.metaKey;
  if (mod && !capture.keys.includes(name)) return null;
  return name;
}

/** Whether a plugin holds this key in the editor that has focus: the
 *  window's own shortcuts, which hear keys first, leave it alone - Emacs's
 *  C-/ is undo, not Toggle Source Mode. */
export function heldByPlugin(event: KeyboardEvent): boolean {
  const view = lastView;
  if (!owner || !view || view.isDestroyed || !view.hasFocus()) return false;
  return captures(event, owner.capture) !== null;
}

// ---------------------------------------------------------------------------
// The editor's side: keys, the block cursor, flash's labels
// ---------------------------------------------------------------------------

interface InputState {
  cursor: "bar" | "block";
  /** Flash's labels (editor-flash.ts). */
  labels: FlashLabel[];
  /** What flash found, lit while it waits for a label. */
  matches: { from: number; to: number }[];
}

const inputKey = new PluginKey<InputState>("plugin-editor-input");

function setCursorStyle(style: "bar" | "block") {
  const view = lastView;
  if (!view || view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(inputKey, { cursor: style }));
}

function clearFlash() {
  const view = lastView;
  if (!view || view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(inputKey, NO_FLASH));
}

const NO_FLASH: Partial<InputState> = { labels: [], matches: [] };

export const editorInputPlugin = $prose(
  () =>
    new Plugin<InputState>({
      key: inputKey,
      state: {
        init: () => ({ cursor: "bar", labels: [], matches: [] }),
        apply(tr, prev) {
          const meta = tr.getMeta(inputKey) as Partial<InputState> | undefined;
          const next = meta ? { ...prev, ...meta } : prev;
          if (tr.docChanged && (next.labels.length || next.matches.length))
            return { ...next, ...NO_FLASH };
          return next;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (!owner) return false;
          const name = captures(event, owner.capture);
          if (!name) return false;
          lastView = view;
          owner.lastKeyAt = Date.now();
          owner.deliver(name);
          return true;
        },
        handleDOMEvents: {
          focus(view) {
            lastView = view;
            return false;
          },
        },
        attributes(state): Record<string, string> {
          const s = inputKey.getState(state);
          return s?.cursor === "block" ? { class: "plugin-cursor-block" } : {};
        },
        decorations(state) {
          const s = inputKey.getState(state);
          if (!s) return null;
          const decos: Decoration[] = [];
          const { selection, doc } = state;
          if (s.cursor === "block" && selection.empty) {
            const at = selection.head;
            const next =
              at < doc.content.size
                ? doc.textBetween(at, at + 1, "\n", "\n")
                : "";
            if (next && next !== "\n")
              decos.push(
                Decoration.inline(at, at + 1, { class: "plugin-block-cursor" }),
              );
            else
              decos.push(
                Decoration.widget(
                  at,
                  () => {
                    const span = document.createElement("span");
                    span.className =
                      "plugin-block-cursor plugin-block-cursor-empty";
                    span.textContent = " ";
                    return span;
                  },
                  { side: 1, key: "plugin-block-cursor" },
                ),
              );
          }
          for (const { from, to } of s.matches)
            decos.push(
              Decoration.inline(from, to, { class: "plugin-flash-match" }),
            );
          // A label goes over the character after its match - never a
          // label's letter -, so the match itself stays readable.
          for (const { pos, label } of s.labels)
            decos.push(
              Decoration.widget(
                pos,
                () => {
                  const anchor = document.createElement("span");
                  anchor.className = "plugin-flash-anchor";
                  const span = document.createElement("span");
                  span.className = "plugin-flash-label";
                  span.textContent = label;
                  anchor.append(span);
                  return anchor;
                },
                { side: -1, key: `flash-${pos}-${label}` },
              ),
            );
          return decos.length ? DecorationSet.create(doc, decos) : null;
        },
      },
      view(view) {
        lastView = view;
        return {
          destroy() {
            if (lastView === view) lastView = null;
          },
        };
      },
    }),
);

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

export type EditorOp =
  | {
      op: "move";
      unit: string;
      count?: number;
      /** Extend the selection from where it is anchored. */
      select?: boolean;
      /** Visual mode's: from the character it started on (visualStart)
       *  to the character the cursor lands on, both in. */
      visual?: boolean;
      char?: string;
      forward?: boolean;
      till?: boolean;
    }
  | { op: "selectLines"; count?: number }
  | { op: "visualStart" }
  | { op: "delete"; copy?: boolean }
  | { op: "deleteLines"; count?: number }
  | { op: "copy" }
  | { op: "copyLines"; count?: number }
  | { op: "deleteChars"; count?: number; back?: boolean }
  | { op: "insertText"; text: string }
  | { op: "pasteLines"; text: string; above?: boolean }
  | { op: "openLine"; above?: boolean }
  | { op: "replaceChar"; char: string }
  | { op: "collapse"; to?: "head" | "start" | "end" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "cursor"; style: "bar" | "block" }
  | { op: "flash"; query: string }
  | {
      op: "flashJump";
      label: string;
      /** Visual mode's: the selection runs on to the label's place. */
      select?: boolean;
      /** For an operator: from the caret to the label's place (or back)
       *  selected. */
      extend?: boolean;
    }
  | { op: "flashClear" };

export interface EditorOpResult {
  /** What a delete or copy took; a line copy ends with "\n". */
  text?: string;
  /** For flash: how many places it found (labelled, once two
   *  characters are typed). */
  labels?: number;
  /** For flash: the labels' letters, nearest the caret first. */
  letters?: string;
  /** Whether the selection is empty now. */
  empty: boolean;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/** Runs one action in the editor that last had the keyboard, for
 *  `plugin`; refused when it isn't the plugin holding the keys or no key
 *  of its came just before. */
export function runEditorOp(plugin: string, action: EditorOp): EditorOpResult {
  if (!owner || owner.plugin !== plugin)
    throw new Error(
      "Only the plugin that has the keyboard acts in the editor.",
    );
  // The cursor's look and flash's labels going change nothing; anything
  // else follows a key.
  const looks = action.op === "cursor" || action.op === "flashClear";
  if (!looks && Date.now() - owner.lastKeyAt > ACT_WITHIN_MS)
    throw new Error("Editor actions follow a key the user pressed.");
  const view = lastView;
  if (!view || view.isDestroyed) throw new Error("No editor.");
  const state = view.state;
  // Each command its own undo step, as in Vim: never merged with the
  // one before it however quickly they came.
  const dispatch = (tr: Transaction) =>
    view.dispatch((tr.docChanged ? closeHistory(tr) : tr).scrollIntoView());
  const result: EditorOpResult = { empty: true };
  const count = Math.max(
    1,
    Math.min(10_000, "count" in action ? (action.count ?? 1) : 1),
  );
  const vertical =
    action.op === "move" && (action.unit === "up" || action.unit === "down");
  if (!vertical && !looks) goalX = null;
  switch (action.op) {
    case "move": {
      const { anchor } = state.selection;
      const head = action.visual && visual ? visual.head : state.selection.head;
      let to = head;
      if (action.unit === "up" || action.unit === "down") {
        goalX ??= view.coordsAtPos(head, 1).left;
        for (let n = 0; n < count; n++)
          to = verticalMove(view, to, action.unit === "down" ? 1 : -1, goalX);
      } else if (action.unit === "docStart") {
        to = TextSelection.atStart(state.doc).from;
      } else if (action.unit === "docEnd") {
        to = TextSelection.atEnd(state.doc).from;
      } else if (action.unit === "docLine") {
        // Line `count` of the document (Vim's :12 and 12G) - a block, or
        // a code block's line -, at its first character that isn't a
        // space.
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
      if (action.visual && visual) {
        visual.head = TextSelection.near($to).head;
        dispatch(
          state.tr.setSelection(
            visualSelection(state, visual.anchor, visual.head),
          ),
        );
        break;
      }
      visual = null;
      const sel = action.select
        ? TextSelection.between(state.doc.resolve(anchor), $to)
        : TextSelection.near($to);
      dispatch(state.tr.setSelection(sel));
      break;
    }
    case "visualStart": {
      const at = state.selection.head;
      visual = { anchor: at, head: at };
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
      if (
        lines.blocks &&
        lines.from === 0 &&
        lines.to === state.doc.content.size
      )
        tr.delete(lines.from + 1, lines.to - 1);
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
        copyText(result.text);
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
      visual = null;
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
    case "cursor":
      view.dispatch(state.tr.setMeta(inputKey, { cursor: action.style }));
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
        if (action.select && visual) {
          visual.head = hit.at;
          tr.setSelection(visualSelection(state, visual.anchor, hit.at));
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
  }
  result.empty = view.state.selection.empty;
  return result;
}
