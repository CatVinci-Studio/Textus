import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { cachedDocument, readSelection } from "../doc-markdown";
import type { SelectionTarget } from "../revision/usePendingEdits";
import type { ChatContext } from "./window/chat-bridge";

/**
 * The editor's state right now, as the detached chat window needs it. That
 * window holds no snapshot of its own. Serializing is not free, so callers
 * push on selection, tab and file changes and before a send, never per key.
 */
export interface LiveEditorState {
  /** What crosses the window boundary. */
  context: ChatContext;
  /** The selection, in THIS window's coordinates (ProseMirror positions mean
   *  nothing in another), for a returning `replace_selection` to target. */
  selection: SelectionTarget;
}

export function readChatContext(
  run: EditorRunner,
  filePath: string | null,
  /** The tab's display name, passed in because a Help doc has no path and
   *  would otherwise show as "Untitled". */
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
