import { useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useFindReplace } from "./useFindReplace";
import { cmFind } from "./cm-find";
import { FindReplaceBar } from "./FindReplaceBar";
import { Presence } from "../../engine/motion/usePresence";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import { currentStrings } from "../../i18n/current";
import { editorInUse } from "../editor-in-use";
import {
  CLOSE_FIND_REPLACE_EVENT,
  FIND_NEXT_EVENT,
  SHOW_REPLACE_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
} from "../../utils/events";

/**
 * Find and replace in a document's source: the rich document's bar, keys
 * and words, on CodeMirror. Returns the bar, to draw beside the source.
 */
export function useSourceFind(view: RefObject<EditorView | null>) {
  const editor = useRef(cmFind(() => view.current)).current;
  const find = useFindReplace(editor);
  // The events mean the source in use, as the rich editor's do.
  const inUse = () => !!view.current && editorInUse(view.current.dom);
  useWindowEvent(TOGGLE_FIND_REPLACE_EVENT, () => inUse() && find.show());
  useWindowEvent(CLOSE_FIND_REPLACE_EVENT, () => find.dismiss());
  useWindowEvent(SHOW_REPLACE_EVENT, () => inUse() && find.showReplace());
  useWindowEvent(FIND_NEXT_EVENT, () => inUse() && find.findNext());
  return (
    <Presence show={find.open}>
      {find.open && (
        <FindReplaceBar findReplace={find} labels={currentStrings()} />
      )}
    </Presence>
  );
}
