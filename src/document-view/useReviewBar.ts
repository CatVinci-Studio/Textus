import { useEffect, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { useLatest } from "../utils/hooks/useLatest";
import type { EditorRunner } from "../editor/useEditorRunner";
import { revealPosition } from "../editor/reveal-position";
import type { PendingEdits } from "./useEditorProposals";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";

/** The elements round this editor its surfaces attach to: the pane the
 *  review bar floats over, and the scroller the margin lines up with. */
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

/** The review bar floats over the pane while there is anything to decide,
 *  except while Quick Ask is open, or on a phone under the AI sheet. */
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
  // On a phone, arriving edits fold the AI sheet away and scroll to the
  // first of them.
  const hadDecidable = useRef(false);
  const decidable = pendingEdits.decidable.length;
  const now = useLatest({ pendingEdits, phone, panelContainer, isActive });
  useEffect(() => {
    const { pendingEdits, phone, panelContainer, isActive } = now.current;
    const has = decidable > 0;
    if (has && !hadDecidable.current && phone && panelContainer && isActive) {
      agentPanel.setOpen(false);
      const first = pendingEdits.reviewStops[0];
      if (first) {
        pendingEdits.pointReview(first.callId, first.index);
        run((ctx) => revealPosition(ctx.get(editorViewCtx), first.from));
      }
    }
    hadDecidable.current = has;
  }, [decidable, now, agentPanel, run]);

  /** ‹ / › in the review bar; F7 / Shift+F7 (`caret`) also put the caret
   *  at the change, where Ctrl/⌘ + Enter or Backspace decide it. */
  function stepReview(delta: 1 | -1, { caret = false } = {}) {
    const stop = pendingEdits.stepReview(delta);
    if (!stop) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (caret) {
        const at = Math.min(stop.from, view.state.doc.content.size);
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.near(view.state.doc.resolve(at)),
          ),
        );
        view.focus();
      }
      revealPosition(view, stop.from);
    });
  }

  // F7 and Shift+F7 step through the changes from anywhere in the window.
  const stepRef = useLatest(stepReview);
  const stops = pendingEdits.reviewStops.length;
  useEffect(() => {
    if (!isActive || stops === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F7" || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as Element).closest?.('[aria-modal="true"]')) return;
      e.preventDefault();
      stepRef.current(e.shiftKey ? -1 : 1, { caret: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isActive, stops, stepRef]);

  // A card's sentence or "Show in text": point the review bar there and
  // bring it into view.
  function revealProposal(callId: string, index: number) {
    const stop = pendingEdits.pointReview(callId, index);
    if (!stop) return;
    run((ctx) => revealPosition(ctx.get(editorViewCtx), stop.from));
  }

  return { reviewBarShown, stepReview, revealProposal };
}
