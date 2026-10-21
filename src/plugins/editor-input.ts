import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import { $prose } from "@milkdown/kit/utils";
import { isMacPlatform } from "../platform/os";

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

/** A key as a plugin sees it: "a", "A", "$", "Escape", "Enter",
 *  "ctrl+r", "alt+f", "shift+Tab". */
export function keyName(event: KeyboardEvent): string {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.metaKey) mods.push("meta");
  const printable = event.key.length === 1;
  if (event.shiftKey && !printable) mods.push("shift");
  const key =
    printable && event.altKey
      ? altKey(event)
      : printable && event.ctrlKey
        ? event.key.toLowerCase()
        : event.key;
  return [...mods, key].join("+");
}

/** The key under an Option (Alt) chord by where it is on the keyboard: on
 *  a Mac, Option+F types "ƒ", but Emacs's M-f means the F key. Keys
 *  outside the letters, digits and these marks keep what they typed. */
const ALT_MARKS: Record<string, [string, string]> = {
  Comma: [",", "<"],
  Period: [".", ">"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Slash: ["/", "?"],
  Minus: ["-", "_"],
  Semicolon: [";", ":"],
  Space: [" ", " "],
};
function altKey(event: KeyboardEvent): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  const mark = ALT_MARKS[event.code];
  if (mark) return mark[event.shiftKey ? 1 : 0];
  return event.key.toLowerCase();
}

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
  labels: { pos: number; label: string }[];
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
  view.dispatch(view.state.tr.setMeta(inputKey, { labels: [] }));
}

export const editorInputPlugin = $prose(
  () =>
    new Plugin<InputState>({
      key: inputKey,
      state: {
        init: () => ({ cursor: "bar", labels: [] }),
        apply(tr, prev) {
          const meta = tr.getMeta(inputKey) as Partial<InputState> | undefined;
          const next = meta ? { ...prev, ...meta } : prev;
          if (tr.docChanged && next.labels.length)
            return { ...next, labels: [] };
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
          for (const { pos, label } of s.labels)
            decos.push(
              Decoration.widget(
                pos,
                () => {
                  const span = document.createElement("span");
                  span.className = "plugin-flash-label";
                  span.textContent = label;
                  return span;
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
// The text around the caret, flattened: a line per text block
// ---------------------------------------------------------------------------

interface Flat {
  text: string;
  /** The document position before each character; a block boundary's
   *  "\n" maps to the end of the block before it. */
  pos: number[];
  /** The position after the last character. */
  end: number;
}

function flatten(doc: ProseNode, from: number, to: number): Flat {
  let text = "";
  const pos: number[] = [];
  let end = from;
  let first = true;
  doc.nodesBetween(from, to, (node, at) => {
    if (node.isTextblock) {
      if (!first) {
        text += "\n";
        pos.push(end);
      }
      first = false;
      end = at + 1;
      return true;
    }
    if (node.isText) {
      const start = Math.max(from, at);
      const stop = Math.min(to, at + node.nodeSize);
      for (let p = start; p < stop; p++) {
        text += node.text![p - at];
        pos.push(p);
      }
      end = stop;
      return false;
    }
    if (node.isInline && node.isLeaf) {
      // A picture, a hard break: one character's room.
      text +=
        node.type.name === "hardbreak" || node.type.name === "hard_break"
          ? "\n"
          : "￼";
      pos.push(at);
      end = at + node.nodeSize;
    }
    return true;
  });
  return { text, pos, end };
}

/** The index in `flat` of document position `p` (the character after it). */
function indexOf(flat: Flat, p: number): number {
  let lo = 0;
  let hi = flat.pos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flat.pos[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function posOf(flat: Flat, i: number): number {
  if (i >= flat.pos.length) return flat.end;
  return flat.pos[Math.max(0, i)];
}

/** The text around `p`, far enough for any one motion. */
function around(state: EditorState, p: number, reach = 20_000): Flat {
  const size = state.doc.content.size;
  return flatten(state.doc, Math.max(0, p - reach), Math.min(size, p + reach));
}

type CharClass = 0 | 1 | 2;
function charClass(ch: string | undefined): CharClass {
  if (!ch || /\s/.test(ch)) return 0;
  if (/[\p{L}\p{N}_]/u.test(ch)) return 2;
  return 1;
}

function lineStartIndex(text: string, i: number): number {
  const at = text.lastIndexOf("\n", i - 1);
  return at + 1;
}
function lineEndIndex(text: string, i: number): number {
  const at = text.indexOf("\n", i);
  return at < 0 ? text.length : at;
}

/** Where a motion from index `i` lands, in `flat`. */
function motion(
  flat: Flat,
  i: number,
  unit: string,
  arg: { char?: string; forward?: boolean; till?: boolean },
): number {
  const t = flat.text;
  switch (unit) {
    case "left":
      return i > lineStartIndex(t, i) ? i - 1 : i;
    case "right": {
      const end = lineEndIndex(t, i);
      return i < end - 1 ? i + 1 : i;
    }
    case "rightInsert": {
      const end = lineEndIndex(t, i);
      return i < end ? i + 1 : i;
    }
    // A character on, or back, across the end of a line too (Emacs's C-f
    // and C-b).
    case "charForward":
      return Math.min(i + 1, t.length);
    case "charBack":
      return Math.max(i - 1, 0);
    case "wordStart": {
      let j = i;
      const c = charClass(t[j]);
      while (j < t.length && charClass(t[j]) === c && c !== 0) j++;
      while (j < t.length && charClass(t[j]) === 0) j++;
      return Math.min(j, t.length);
    }
    case "wordEnd": {
      let j = i + 1;
      while (j < t.length && charClass(t[j]) === 0) j++;
      const c = charClass(t[j]);
      while (j + 1 < t.length && charClass(t[j + 1]) === c) j++;
      return Math.min(j, Math.max(0, t.length - 1));
    }
    case "wordBack": {
      let j = i - 1;
      while (j > 0 && charClass(t[j]) === 0) j--;
      const c = charClass(t[j]);
      while (j > 0 && charClass(t[j - 1]) === c) j--;
      return Math.max(0, j);
    }
    case "lineStart":
      return lineStartIndex(t, i);
    case "lineFirstChar": {
      let j = lineStartIndex(t, i);
      while (j < t.length && t[j] !== "\n" && /\s/.test(t[j])) j++;
      return j;
    }
    case "lineEnd": {
      const end = lineEndIndex(t, i);
      return Math.max(lineStartIndex(t, i), end - 1);
    }
    case "lineEndInsert":
      return lineEndIndex(t, i);
    case "paragraphNext": {
      let j = lineEndIndex(t, i);
      while (j < t.length && t[j] === "\n") j++;
      return Math.min(lineEndIndex(t, j), t.length);
    }
    case "paragraphPrev": {
      const j = lineStartIndex(t, i) - 1;
      if (j < 0) return 0;
      return lineStartIndex(t, j);
    }
    case "findChar": {
      const ch = arg.char ?? "";
      if (!ch) return i;
      if (arg.forward !== false) {
        const end = lineEndIndex(t, i);
        const at = t.indexOf(ch, i + 1 + (arg.till ? 1 : 0));
        if (at < 0 || at >= end) return i;
        return arg.till ? at - 1 : at;
      }
      const start = lineStartIndex(t, i);
      const at = t.lastIndexOf(ch, i - 1 - (arg.till ? 1 : 0));
      if (at < start) return i;
      return arg.till ? at + 1 : at;
    }
  }
  return i;
}

/** The line a visual move up or down lands on, keeping the column. */
function verticalMove(view: EditorView, head: number, dir: 1 | -1): number {
  const at = view.coordsAtPos(head);
  const lineHeight = Math.max(8, at.bottom - at.top);
  const target = view.posAtCoords({
    left: at.left + 1,
    top: dir > 0 ? at.bottom + lineHeight / 2 : at.top - lineHeight / 2,
  });
  return target ? target.pos : head;
}

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
  | { op: "flashJump"; label: string; select?: boolean }
  | { op: "flashClear" };

export interface EditorOpResult {
  /** What a delete or copy took; a line copy ends with "\n". */
  text?: string;
  /** For flash: how many places it labelled. */
  labels?: number;
  /** Whether the selection is empty now. */
  empty: boolean;
}

/** Lines covering the selection's head, `count` of them: their range and
 *  text, each a text block (a code block's lines, there). */
function linesRange(
  state: EditorState,
  count: number,
): { from: number; to: number; text: string; blocks: boolean } {
  const { $head } = state.selection;
  let depth = $head.depth;
  while (depth > 0 && !$head.node(depth).isTextblock) depth--;
  const block = $head.node(depth);
  if (block.type.spec.code) {
    // A code block: its own lines.
    const start = $head.start(depth);
    const text = block.textContent;
    const offset = $head.pos - start;
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    let lineEnd = lineStart;
    for (let n = 0; n < count; n++) {
      const next = text.indexOf("\n", lineEnd);
      lineEnd = next < 0 ? text.length : next + (n < count - 1 ? 1 : 0);
      if (next < 0) break;
    }
    const from = start + lineStart;
    const to = start + lineEnd;
    const withBreak = lineEnd < text.length ? to + 1 : to;
    return {
      from: lineStart > 0 && withBreak === to ? from - 1 : from,
      to: withBreak,
      text: text.slice(lineStart, lineEnd) + "\n",
      blocks: false,
    };
  }
  const from = $head.before(depth);
  let to = $head.after(depth);
  const texts = [block.textContent];
  for (let n = 1; n < count; n++) {
    const next = state.doc.resolve(Math.min(to + 1, state.doc.content.size));
    let d = next.depth;
    while (d > 0 && !next.node(d).isTextblock) d--;
    if (d === 0 || next.before(d) < to) break;
    texts.push(next.node(d).textContent);
    to = next.after(d);
  }
  return { from, to, text: texts.join("\n") + "\n", blocks: true };
}

function selectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, "\n", "￼");
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

const LABELS = "asdfghjklqwertyuiopzxcvbnm";

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
  switch (action.op) {
    case "move": {
      const { anchor } = state.selection;
      const head = action.visual && visual ? visual.head : state.selection.head;
      let to = head;
      if (action.unit === "up" || action.unit === "down") {
        for (let n = 0; n < count; n++)
          to = verticalMove(view, to, action.unit === "down" ? 1 : -1);
      } else if (action.unit === "docStart") {
        to = TextSelection.atStart(state.doc).from;
      } else if (action.unit === "docEnd") {
        to = TextSelection.atEnd(state.doc).from;
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
      const query = action.query.toLowerCase();
      const box = view.dom.getBoundingClientRect();
      const top = view.posAtCoords({
        left: box.left + 4,
        top: Math.max(box.top, 0) + 4,
      });
      const bottom = view.posAtCoords({
        left: box.right - 4,
        top: Math.min(box.bottom, window.innerHeight) - 4,
      });
      const from = top ? top.pos : 0;
      const to = bottom ? bottom.pos : state.doc.content.size;
      const flat = flatten(state.doc, Math.min(from, to), Math.max(from, to));
      const hay = flat.text.toLowerCase();
      const found: number[] = [];
      for (
        let at = hay.indexOf(query);
        query && at >= 0;
        at = hay.indexOf(query, at + 1)
      )
        found.push(at);
      // A label is never a letter that could go on the match.
      const after = new Set(found.map((at) => hay[at + query.length]));
      const labels = [...LABELS].filter((l) => !after.has(l));
      const placed = found
        .slice(0, labels.length)
        .map((at, n) => ({ pos: posOf(flat, at), label: labels[n] }));
      view.dispatch(state.tr.setMeta(inputKey, { labels: placed }));
      result.labels = placed.length;
      break;
    }
    case "flashJump": {
      const labels = inputKey.getState(state)?.labels ?? [];
      const hit = labels.find((l) => l.label === action.label);
      const tr = state.tr.setMeta(inputKey, { labels: [] });
      if (hit) {
        if (action.select && visual) {
          visual.head = hit.pos;
          tr.setSelection(visualSelection(state, visual.anchor, hit.pos));
        } else {
          tr.setSelection(TextSelection.near(state.doc.resolve(hit.pos)));
        }
      }
      dispatch(tr);
      result.labels = hit ? 1 : 0;
      break;
    }
    case "flashClear":
      view.dispatch(state.tr.setMeta(inputKey, { labels: [] }));
      break;
  }
  result.empty = view.state.selection.empty;
  return result;
}
