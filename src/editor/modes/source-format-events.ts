import type { EditorView } from "@codemirror/view";
import { editorInUse } from "../editor-in-use";
import { isolateHistory } from "@codemirror/commands";
import {
  INSERT_BLOCK_EVENT,
  INSERT_LINK_EVENT,
  INSERT_MARKDOWN_EVENT,
  TOGGLE_MARK_EVENT,
} from "../../utils/events";
import {
  insertSourceLink,
  setSourceBlock,
  toggleSourceMark,
} from "./source-format";

/** A mark's key in source mode: written out, or false when the source is
 *  read-only. */
export function formatSource(view: EditorView, mark: string): boolean {
  return !view.state.readOnly && toggleSourceMark(view, mark);
}

/** Markdown put in at the caret (Insert at Cursor, a link from the file
 *  tree), as written: its own undo step. */
function insertSourceMarkdown(view: EditorView, markdown: string): boolean {
  view.dispatch(view.state.replaceSelection(markdown), {
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  return true;
}

/** What each window event does in the source editor; true when it did
 *  something. */
const ACTIONS: Record<string, (view: EditorView, detail: string) => boolean> = {
  [TOGGLE_MARK_EVENT]: toggleSourceMark,
  [INSERT_BLOCK_EVENT]: setSourceBlock,
  [INSERT_LINK_EVENT]: (view) => (insertSourceLink(view), true),
  [INSERT_MARKDOWN_EVENT]: insertSourceMarkdown,
};

/** The Format menu and its keys (marks, headings, lists, a quote, a link),
 *  and Markdown put in at the caret, reach the source editor in use, as
 *  they reach the rendered one. Returns the stop. */
export function followFormatMenu(view: EditorView): () => void {
  const run = (e: Event) => {
    if (view.state.readOnly || !editorInUse(view.dom)) return;
    if (ACTIONS[e.type](view, (e as CustomEvent<string>).detail)) view.focus();
  };
  const types = Object.keys(ACTIONS);
  for (const type of types) window.addEventListener(type, run);
  return () => {
    for (const type of types) window.removeEventListener(type, run);
  };
}
