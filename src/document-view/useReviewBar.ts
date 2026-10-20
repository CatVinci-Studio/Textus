import { useEffect, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import { revealPosition } from "../editor/reveal-position";
import type { PendingEdits } from "./useEditorProposals";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";

/** The elements round this editor that its surfaces attach to: the pane
 *  the review bar floats over, and the scroller and content column the
 *  review margin lines up with. */
export function useEditorPane() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPaneEl(
      (rootRef.current?.closest(".main-pane") as HTMLElement | null) ?? null,
    );
    setScrollEl(
      (rootRef.current?.closest(".editor-scroll") as HTMLElement | null) ??
        null,
    );
    setContentEl(
      (rootRef.current?.closest(".editor-content") as HTMLElement | null) ??
        null,
    );
  }, []);
  return { rootRef, paneEl, scrollEl, contentEl };
}

/** The review bar (ai/revision/ReviewBar.tsx) floats over the bottom of the
 *  pane this editor scrolls in, while there is anything to decide, or a
 *  rewrite streaming in whose changes will be (usePendingEdits.reviewed) -
 *  except while Quick Ask, which has its own, is open, and on a phone while
 *  the AI sheet covers the text. */
export function useReviewBar({
  run,
  pendingEdits,
  isActive,
  phone,
  quickAskVisible,
  panelContainer,
  agentPanel,
}: {
  run: EditorRunner;
  pendingEdits: PendingEdits;
  isActive: boolean;
  phone: boolean;
  quickAskVisible: boolean;
  panelContainer: HTMLElement | null;
  agentPanel: AgentPanelFrame;
}) {
  const reviewBarShown =
    isActive &&
    pendingEdits.reviewed.length > 0 &&
    !quickAskVisible &&
    !(phone && panelContainer);
  // On a phone, the edits arriving fold the AI sheet away so the text they
  // change is what's on screen, scrolled to the first of them; the bar
  // has the way back into the conversation.
  const hadDecidable = useRef(false);
  useEffect(() => {
    const has = pendingEdits.decidable.length > 0;
    if (has && !hadDecidable.current && phone && panelContainer && isActive) {
      agentPanel.setOpen(false);
      const first = pendingEdits.reviewStops[0];
      if (first) {
        pendingEdits.pointReview(first.callId, first.index);
        run((ctx) => revealPosition(ctx.get(editorViewCtx), first.from));
      }
    }
    hadDecidable.current = has;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits.decidable.length]);

  function stepReview(delta: 1 | -1) {
    const stop = pendingEdits.stepReview(delta);
    if (stop) run((ctx) => revealPosition(ctx.get(editorViewCtx), stop.from));
  }

  // A card's sentence or "Show in text": point the review bar there and
  // bring it into view.
  function revealProposal(callId: string, index: number) {
    const stop = pendingEdits.pointReview(callId, index);
    if (!stop) return;
    run((ctx) => revealPosition(ctx.get(editorViewCtx), stop.from));
  }

  return { reviewBarShown, stepReview, revealProposal };
}
