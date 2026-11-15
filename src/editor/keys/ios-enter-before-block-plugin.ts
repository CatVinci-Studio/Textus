import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// On iOS prosemirror-view leaves Enter to the page and reads the new line
// back, with its own Enter 200ms on if none comes. At a line's end with a
// table next, WebKit puts that line in the table, so the page's is refused.
interface ViewInput {
  input?: { lastIOSEnter?: number };
}

const IOS_ENTER_WAIT = 200;

/** The caret at the end of a line whose next block is no line (a table). */
function atEndBeforeBlock(state: EditorState): boolean {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  if ($from.parentOffset < $from.parent.content.size) return false;
  const next = state.doc.resolve($from.after()).nodeAfter;
  return !!next && !next.isTextblock;
}

export const iosEnterBeforeBlockPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          beforeinput(view: EditorView, event: InputEvent) {
            if (event.inputType !== "insertParagraph" || view.composing)
              return false;
            const pressed = (view as ViewInput).input?.lastIOSEnter ?? 0;
            if (Date.now() - pressed > IOS_ENTER_WAIT) return false;
            if (!atEndBeforeBlock(view.state)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);
