import { useCallback, useEffect, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";

/** The live selection, for the docked panel's selection chip and the
 *  highlight that keeps it visible (the detached window's too, while this
 *  is the active tab). Plain text and bounds only - cheap enough per
 *  selection change; the markdown the request carries is serialized once,
 *  at send (panelSendContext). */
export function usePanelSelection(run: EditorRunner, tracking: boolean) {
  const trackingRef = useLatest(tracking);
  const [panelSelection, setPanelSelection] = useState<{
    text: string;
    range: { from: number; to: number };
  } | null>(null);
  const updatePanelSelection = useCallback(() => {
    if (!trackingRef.current) return;
    const next = run((ctx) => {
      const { selection, doc } = ctx.get(editorViewCtx).state;
      return selection.empty
        ? null
        : {
            text: doc.textBetween(selection.from, selection.to, " "),
            range: { from: selection.from, to: selection.to },
          };
    });
    if (next === undefined) return;
    setPanelSelection((prev) =>
      prev?.range.from === next?.range.from && prev?.range.to === next?.range.to
        ? prev
        : next,
    );
    // run is stable; trackingRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  useEffect(() => {
    if (tracking) updatePanelSelection();
  }, [tracking, updatePanelSelection]);
  return { panelSelection, updatePanelSelection };
}
