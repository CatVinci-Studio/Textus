import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
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
  const { visible } = inlineChat;
  const widgetPos = useLatest(inlineChat.chatInfo?.widgetPos ?? null);
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        setQuickAskWidget(
          view.state.tr,
          visible && !phone ? widgetPos.current : null,
        ),
      );
    });
  }, [visible, phone, run, widgetPos]);
}
