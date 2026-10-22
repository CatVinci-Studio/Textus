import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useEditorProposals } from "./useEditorProposals";
import {
  cachedDocument,
  readSelection,
  serializeRange,
} from "../ai/doc-markdown";
import { selectedTextBlock } from "../ai/chat/user-message";
import { proposalsFromTurns } from "../ai/chat/ChatBody";
import type { useAgentPanel } from "../ai/chat/panel/agent-panel";
import type { Strings } from "../i18n/strings";

/**
 * The editor menu's "Illustrate this paragraph": asks Textus AI, in the
 * panel's conversation and in Write mode, for one picture for the selected
 * text - or, with nothing selected, the paragraph right-clicked (`at`, the
 * menu's point), else the one the caret is in - which
 * comes back as a proposal after it (generate_image). Offered only while
 * an image model is set (EditorContextMenu).
 */
export function useIllustrateParagraph({
  run,
  proposals,
  agentPanel,
  t,
}: {
  run: EditorRunner;
  proposals: ReturnType<typeof useEditorProposals>;
  agentPanel: ReturnType<typeof useAgentPanel>;
  t: Strings;
}) {
  const { conversation, requestTargetRef, showProposals } = proposals;
  return useCallback(
    (at?: { x: number; y: number }) => {
      const request = run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const selection = readSelection(ctx, state);
        let markdown = selection.selectionMarkdown;
        let range = selection.range;
        if (!markdown) {
          const clicked = at && view.posAtCoords({ left: at.x, top: at.y });
          const $from = clicked
            ? state.doc.resolve(clicked.pos)
            : state.selection.$from;
          if (
            !$from.parent.isTextblock ||
            $from.parent.textContent.trim() === ""
          )
            return null;
          range = { from: $from.start(), to: $from.end() };
          markdown = serializeRange(ctx, state.doc, range.from, range.to);
        }
        requestTargetRef.current = {
          range,
          selectionMarkdown: markdown,
          cursor: null,
        };
        return { document: cachedDocument(ctx, state.doc), markdown };
      });
      if (!request) return;
      agentPanel.setOpen(true);
      const message = `${selectedTextBlock(request.markdown)}\n\n${t.illustrateParagraphRequest}`;
      void conversation
        .send(request.document, message, [], {
          mode: "write",
          webSearch: false,
        })
        .then((turns) => {
          // The panel shows them as they stream in; this is for a panel
          // that wasn't mounted yet. Adding the same proposal twice is a
          // no-op.
          const found = proposalsFromTurns(turns ?? []);
          if (found.length > 0) showProposals(found);
        });
    },
    [run, requestTargetRef, agentPanel, conversation, showProposals, t],
  );
}
