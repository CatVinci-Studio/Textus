import type { EditProposal } from "../types";
import type { ProposalStreamEffects } from "./proposal-stream";
import { stopRewrite, streamPendingInsertText } from "./pending-edit-plugin";

/**
 * How a proposal streaming in is shown - the ProposalStream machine's
 * effects (proposal-stream.ts decides what happens, these how it looks):
 *
 * - `typewriter`: the draft is placed once and its text typed in as it
 *   arrives (pending-edit-plugin's reveal, a rewrite sentence by sentence
 *   with the progress cursor);
 * - `drawn`: no typewriter - edit animation off, or the system's Reduce
 *   motion - the draft drawn again with what has arrived, at most every
 *   DRAW_EVERY ms. Streaming used to be skipped then: "Thinking…" until
 *   every edit appeared at once (rc.6).
 *
 * Either way the completed call's own add (ChatBody's completed turns)
 * makes it decidable.
 */

/** What a display draws with: the editor's preview adds (streaming or
 *  final), its discard, and the text as it is drawn - a picture's line as
 *  its frame (generated-images' withBegunPictures). */
export interface ProposalCanvas {
  show(callId: string, proposal: EditProposal, streaming: boolean): void;
  discard(callId: string): void;
  text(callId: string, text: string): string;
}

export function typewriter(canvas: ProposalCanvas): ProposalStreamEffects {
  return {
    place: (callId, proposal) => canvas.show(callId, proposal, true),
    feed: (callId, text, done) =>
      streamPendingInsertText(callId, canvas.text(callId, text), done),
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
      if (done) return forget(callId);
      latest.set(callId, text);
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

/**
 * One set of effects that shows each call the way it started: a setting
 * changed mid-stream doesn't switch a draft from one display to the other.
 */
export function perCall(
  displays: { typewriter: ProposalStreamEffects; drawn: ProposalStreamEffects },
  animated: () => boolean,
): ProposalStreamEffects {
  // Kept past the done feed: a stop's finalize follows it (proposal-
  // stream.ts' finish). A completed call never hears more, so the oldest
  // go once there are many.
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
    feed: (callId, text, done) => of(callId).feed(callId, text, done),
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
