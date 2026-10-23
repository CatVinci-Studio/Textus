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
    /** The selection is one picture: `text` is its description, which
     *  the picture's own text would leave empty (no chip at all). */
    picture: boolean;
  } | null>(null);
  const updatePanelSelection = useCallback(() => {
    if (!trackingRef.current) return;
    const next = run((ctx) => {
      const { selection, doc } = ctx.get(editorViewCtx).state;
      if (selection.empty) return null;
      const range = { from: selection.from, to: selection.to };
      const node = doc.nodeAt(selection.from);
      if (
        node?.type.name.startsWith("image") &&
        selection.to - selection.from === node.nodeSize
      )
        return {
          text: String(node.attrs.alt || node.attrs.src || "image"),
          range,
          picture: true,
        };
      return {
        text: doc.textBetween(selection.from, selection.to, " "),
        range,
        picture: false,
      };
    });
    if (next === undefined) return;
    setPanelSelection((prev) =>
      prev?.range.from === next?.range.from && prev?.range.to === next?.range.to
        ? prev
        : next,
    );
  }, [run, trackingRef]);
  useEffect(() => {
    if (tracking) updatePanelSelection();
  }, [tracking, updatePanelSelection]);
  return { panelSelection, updatePanelSelection };
}
