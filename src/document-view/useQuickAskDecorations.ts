import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import { setQuickAskWidget } from "../ai/chat/quick-ask/quick-ask-widget-plugin";

/** What Quick Ask draws in the document: the zone widget its panel portals
 *  into. */
export function useQuickAskDecorations(
  run: EditorRunner,
  inlineChat: ReturnType<typeof useInlineChat>,
  phone: boolean,
) {
  // Keyed on `visible` alone: once shown, the plugin remaps the widget
  // through edits, and re-running on chatInfo would snap it back. On a phone
  // there is no widget; the panel docks above the keyboard.
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
