import type { EditProposal } from "../types";
import type { ProposalStreamEffects } from "./proposal-stream";
import { stopRewrite, streamPendingInsertText } from "./pending-edit-plugin";

/** How a streaming proposal is shown: typed in as it arrives, or, with motion
 *  off, redrawn at most every DRAW_EVERY ms. The completed call makes it decidable. */

/** What a display draws with: the editor's preview adds, its discard, and
 *  the text as it is drawn. */
export interface ProposalCanvas {
  show(callId: string, proposal: EditProposal, streaming: boolean): void;
  discard(callId: string): void;
  text(callId: string, text: string): string;
}

export function typewriter(canvas: ProposalCanvas): ProposalStreamEffects {
  return {
    place: (callId, proposal) => canvas.show(callId, proposal, true),
    feed: (callId, text, done, final) =>
      streamPendingInsertText(callId, canvas.text(callId, text), done, final),
    finalize: (callId, proposal) => {
      // A rewrite stopped while it typed in sentence by sentence keeps
      // what it reads as on screen.
      const kept = stopRewrite(
        callId,
        canvas.text(callId, proposal.text ?? ""),
      );
      if (kept) streamPendingInsertText(callId, kept, true);
      canvas.show(callId, proposal, false);
    },
    discard: (callId) => canvas.discard(callId),
  };
}

const DRAW_EVERY = 150;

export function drawn(canvas: ProposalCanvas): ProposalStreamEffects {
  const placed = new Map<string, EditProposal>();
  const latest = new Map<string, string>();
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  const draw = (callId: string) => {
    waiting.delete(callId);
    const proposal = placed.get(callId);
    const text = latest.get(callId);
    if (proposal && text !== undefined)
      canvas.show(callId, { ...proposal, text }, true);
  };
  const forget = (callId: string) => {
    clearTimeout(waiting.get(callId));
    waiting.delete(callId);
    placed.delete(callId);
    latest.delete(callId);
  };
  return {
    place: (callId, proposal) => {
      placed.set(callId, proposal);
      latest.set(callId, proposal.text ?? "");
      draw(callId);
    },
    feed: (callId, text, done) => {
      latest.set(callId, text);
      // Whole: drawn as it is now, the call's own add following.
      if (done) {
        draw(callId);
        return forget(callId);
      }
      if (!waiting.has(callId))
        waiting.set(
          callId,
          setTimeout(() => draw(callId), DRAW_EVERY),
        );
    },
    finalize: (callId, proposal) => {
      forget(callId);
      canvas.show(callId, proposal, false);
    },
    discard: (callId) => {
      forget(callId);
      canvas.discard(callId);
    },
  };
}

const KEPT_CALLS = 64;

/** Shows each call the way it started, so a setting changed mid-stream
 *  doesn't switch a draft's display. */
export function perCall(
  displays: { typewriter: ProposalStreamEffects; drawn: ProposalStreamEffects },
  animated: () => boolean,
): ProposalStreamEffects {
  // Kept past the done feed, as a stop's finalize follows it; the oldest go
  // once there are many.
  const chosen = new Map<string, ProposalStreamEffects>();
  const of = (callId: string) => chosen.get(callId) ?? displays.drawn;
  return {
    place: (callId, proposal) => {
      const display = animated() ? displays.typewriter : displays.drawn;
      chosen.set(callId, display);
      if (chosen.size > KEPT_CALLS)
        chosen.delete(chosen.keys().next().value as string);
      display.place(callId, proposal);
    },
    feed: (callId, text, done, final) =>
      of(callId).feed(callId, text, done, final),
    finalize: (callId, proposal) => {
      of(callId).finalize(callId, proposal);
      chosen.delete(callId);
    },
    discard: (callId) => {
      of(callId).discard(callId);
      chosen.delete(callId);
    },
  };
}
