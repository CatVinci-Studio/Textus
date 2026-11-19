import { EditorView } from "@codemirror/view";
import {
  indentLess,
  indentMore,
  insertBlankLine,
  insertTab,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { comboFromEvent, EDITOR_BLOCK_COMBOS } from "../../utils/shortcuts";
import { modIsMeta } from "../../platform/os";
import {
  insertSourceLink,
  setSourceBlock,
  toggleSourceFence,
  toggleSourceMark,
} from "./source-format";

type Run = (view: EditorView) => boolean;
const mark =
  (name: string): Run =>
  (view) =>
    toggleSourceMark(view, name);
const block =
  (kind: string): Run =>
  (view) =>
    setSourceBlock(view, kind);
const B = EDITOR_BLOCK_COMBOS;

/** A list's or a to-do's line: a bullet or a number, then a space. */
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Tab: on a list's line the whole line goes in a level, wherever the caret
 *  is in it, as in the rendered view; anywhere else a tab at the caret. */
export const sourceTab: Run = (view) => {
  const { state } = view;
  const onList = state.selection.ranges.every((range) =>
    LIST_LINE.test(state.doc.lineAt(range.head).text),
  );
  return onList ? indentMore(view) : insertTab(view);
};

/**
 * The rendered editor's keys, writing their Markdown in source mode: the
 * Format menu's marks (a Mac's menu takes those keys first; Windows and
 * Linux leave them to the page), the block keys, and moving and indenting
 * lines. The headings' Mod+1-6 come through the Format menu's event.
 */
const KEYS: Record<string, Run> = {
  "mod+shift+h": mark("highlight"),
  "ctrl+shift+`": mark("strikethrough"),
  "ctrl+`": mark("code"),
  "mod+k": (view) => (insertSourceLink(view), true),
  [B.paragraph]: block("paragraph"),
  [B.h1]: block("h1"),
  [B.h2]: block("h2"),
  [B.h3]: block("h3"),
  [B.h4]: block("h4"),
  [B.h5]: block("h5"),
  [B.h6]: block("h6"),
  [B.orderedList]: block("ordered-list"),
  [B.bulletList]: block("bullet-list"),
  [B.blockquote]: block("blockquote"),
  [B.codeBlock]: toggleSourceFence,
  [B.indent]: indentMore,
  [B.outdent]: indentLess,
  "alt+arrowup": moveLineUp,
  "alt+arrowdown": moveLineDown,
  "mod+enter": insertBlankLine,
};

/** Keys whose character a held Alt or Shift changes (a Mac's Alt+2 is
 *  "™"), read by where they are instead. */
const PLACED: Record<string, string> = {
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
};

function placedKey(e: KeyboardEvent): string | null {
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return PLACED[e.code] ?? null;
}

/** `e`'s combo as the table above writes it. */
function sourceCombo(e: KeyboardEvent): string | null {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const key = e.key.toLowerCase();
  const placed =
    e.altKey || (e.shiftKey && !/^[a-z0-9]$/.test(key)) ? placedKey(e) : null;
  const named = placed ? combo.replace(/[^+]+$/, placed) : combo;
  // Off a Mac, Ctrl is the command key: the table's ctrl+ is its mod+.
  return modIsMeta() ? named : named.replace(/(^|\+)mod\+/, "$1ctrl+");
}

/** The table with Ctrl for the command key off a Mac. */
const OWN: Record<string, Run> = modIsMeta()
  ? KEYS
  : Object.fromEntries(
      Object.entries(KEYS).map(([combo, run]) => [
        combo.replace(/(^|\+)mod\+/, "$1ctrl+"),
        run,
      ]),
    );

/** The keys above, for a source editor. */
export const sourceKeys = EditorView.domEventHandlers({
  keydown(event, view) {
    if (view.state.readOnly) return false;
    const combo = sourceCombo(event);
    const run = combo ? OWN[combo] : undefined;
    if (!run || !run(view)) return false;
    event.preventDefault();
    return true;
  },
});
