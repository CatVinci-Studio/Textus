import type { EditorView } from "@codemirror/view";
import { editorInUse } from "../editor-in-use";
import {
  INSERT_BLOCK_EVENT,
  INSERT_LINK_EVENT,
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

/** The Format menu and its keys (marks, headings, lists, a quote, a link)
 *  reach the source editor in use, as they reach the rendered one. Returns
 *  the stop. */
export function followFormatMenu(view: EditorView): () => void {
  const run = (e: Event) => {
    if (view.state.readOnly || !editorInUse(view.dom)) return;
    const detail = (e as CustomEvent<string>).detail;
    const done =
      e.type === TOGGLE_MARK_EVENT
        ? toggleSourceMark(view, detail)
        : e.type === INSERT_BLOCK_EVENT
          ? setSourceBlock(view, detail)
          : (insertSourceLink(view), true);
    if (done) view.focus();
  };
  const types = [TOGGLE_MARK_EVENT, INSERT_BLOCK_EVENT, INSERT_LINK_EVENT];
  for (const type of types) window.addEventListener(type, run);
  return () => {
    for (const type of types) window.removeEventListener(type, run);
  };
}
