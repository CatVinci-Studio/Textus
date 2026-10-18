import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import { setQuickAskWidget } from "../ai/chat/quick-ask/quick-ask-widget-plugin";

/** What Quick Ask draws in the document: the zone widget its panel portals
 *  into. The highlight over the passage it was opened on is
 *  useChatSelectionHighlight's, shared with the AI panel. */
export function useQuickAskDecorations(
  run: EditorRunner,
  inlineChat: ReturnType<typeof useInlineChat>,
  phone: boolean,
) {
  // Shows/hides the Quick Ask zone widget. Keyed on `visible` alone (NOT
  // chatInfo.widgetPos) - once shown, the plugin remaps the widget's
  // position through edits on its own; re-running this on every chatInfo
  // change would snap it back to the position captured at open time and
  // undo that tracking. `visible` transitioning true is exactly "just
  // opened (or reopened)", which is the only moment a fresh position makes
  // sense - `open()` always sets both chatInfo and visible together.
  // On a phone there is no widget at all: the panel docks above the
  // keyboard instead (InlineChat's `docked`), since a block in the
  // document ends up under the keyboard with no way to scroll to it.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        setQuickAskWidget(
          view.state.tr,
          inlineChat.visible && !phone
            ? (inlineChat.chatInfo?.widgetPos ?? null)
            : null,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineChat.visible, phone, run]);
}
