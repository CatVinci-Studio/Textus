import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { cachedDocument, readSelection } from "../doc-markdown";
import type { SelectionTarget } from "../revision/usePendingEdits";
import type { ChatContext } from "./window/chat-bridge";

/**
 * The editor's state right now, as the detached chat window needs it.
 *
 * This is what makes the detached window the CROSS-FILE surface: it holds no
 * snapshot of its own, so whatever the active editor reports here is the
 * document it is about, the selection its chip shows, and the file its edits
 * land in. The docked panel and Quick Ask, by contrast, live inside one
 * editor and read it directly before each send (useInlineChat's
 * sendContext).
 *
 * Reading the whole document is not free (every top-level block is
 * re-serialized to markdown), which is why callers push this on selection,
 * tab and file changes - discrete user actions - and on demand before a
 * send, never on every keystroke.
 */
export interface LiveEditorState {
  /** What crosses the window boundary. */
  context: ChatContext;
  /** The selection, in THIS window's coordinates - ProseMirror positions mean
   *  nothing in another one. This is what a `replace_selection` proposal
   *  coming back from the chat targets, so it has to be remembered here at
   *  the moment the selection is sent. */
  selection: SelectionTarget;
}

export function readChatContext(
  run: EditorRunner,
  filePath: string | null,
  /** The tab's display name, from `tabTitle` - passed in rather than derived
   *  from `filePath`, because a Help doc has no path and would otherwise
   *  show as "Untitled" in the chat window. */
  docTitle: string,
  editorLabel: string,
): LiveEditorState | null {
  return (
    run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      const { selectedText, selectionMarkdown, range } = readSelection(
        ctx,
        state,
      );
      return {
        context: {
          document: cachedDocument(ctx, state.doc),
          selectedText,
          selectionMarkdown,
          docPath: filePath,
          docTitle,
          editorLabel,
        },
        // The same markdown the chat was shown, so the staleness check a
        // replace_selection proposal runs later compares like with like.
        selection: { range, selectionMarkdown },
      } satisfies LiveEditorState;
    }) ?? null
  );
}
