import { draftProposal } from "../chat/partial-tool-args";
import { parseProposal } from "../chat/proposal";
import type { EditProposal } from "../types";

/**
 * The writing-phase state machine for streamed propose_edit calls - the one
 * place that decides when a draft becomes visible, what happens to it when
 * the stream ends, and which endings keep it. Consolidates what used to be
 * an args-accumulating ref in MilkdownEditor plus a cleanup effect whose
 * stop/error behavior lived apart from the streaming logic it undid.
 *
 * Per callId:
 *
 *             argsDelta                argsDelta (anchor complete)
 *   toolStart ────────► drafting ──────────────────────► revealing
 *                          │                                 │  feed() per delta
 *      finish(any) ──────► forgotten (nothing on screen)     │
 *                                                            │
 *        finalCall(parseable args) ────────────────────────► feed(done) - leaves the machine
 *        finalCall(unparseable args) ──────────────────────► discard()
 *        finish("stopped") ────────────────────────────────► feed(done) + finalize(partial)
 *        finish("failed") ─────────────────────────────────► discard()
 *
 * "stopped" keeps what the user already watched type into the document -
 * frozen at the text streamed so far, re-shown without the streaming flag so
 * it becomes decidable (a rewrite laid out sentence by sentence keeps what
 * it reads as on screen: pending-edit-plugin's stopRewrite, which the
 * editor's finalize applies). "failed" discards instead: the error path offers
 * Retry, and a kept preview would duplicate the retried proposal.
 *
 * The machine ends where the DECIDING phase begins: after finalize/feed-done
 * the preview's life continues as a PendingStatus (usePendingEdits.ts:
 * streaming → pending → accepted/rejected/invalid), driven by the typewriter
 * settle (pending-edit-plugin.ts) and the user's Accept/Reject. Exchange
 * boundaries are also outside the machine: a NEW exchange's first placed
 * proposal supersedes whatever previews the user left undecided
 * (MilkdownEditor's addPreviews wrapper), and each send reports every past
 * proposal's current status to the model (proposal-status.ts). The full
 * picture lives in docs/design/ai-proposals.md.
 */
export interface ProposalStreamEffects {
  /** First moment the draft can be located: show it as a streaming
   *  (un-decidable) preview at its anchor. */
  place(callId: string, proposal: EditProposal): void;
  /** Text for the callId's typewriter as known so far; `done` promises no
   *  more will come, which is what lets the reveal settle. */
  feed(callId: string, text: string, done: boolean): void;
  /** A stop froze this draft: re-show it as a final, decidable proposal
   *  carrying the partially streamed text. */
  finalize(callId: string, proposal: EditProposal): void;
  /** Remove the placed preview - this draft must not survive. */
  discard(callId: string): void;
}

interface Draft {
  phase: "drafting" | "revealing";
  args: string;
}

export class ProposalStream {
  private drafts = new Map<string, Draft>();

  constructor(private effects: ProposalStreamEffects) {}

  /** A tool call opened - only propose_edit enters the machine. */
  toolStart(callId: string, toolName: string): void {
    if (toolName === "propose_edit")
      this.drafts.set(callId, { phase: "drafting", args: "" });
  }

  /** An argument fragment arrived. Places the preview the first time the
   *  accumulated args parse far enough to locate (partial-tool-args), and
   *  feeds the typewriter from then on. */
  argsDelta(callId: string, delta: string): void {
    const draft = this.drafts.get(callId);
    if (!draft) return;
    draft.args += delta;
    const parsed = draftProposal(draft.args);
    if (!parsed) return;
    if (draft.phase === "drafting") {
      draft.phase = "revealing";
      this.effects.place(callId, parsed.proposal);
    }
    this.effects.feed(callId, parsed.proposal.text ?? "", false);
  }

  /** The completed ToolCall turn landed: the authoritative arguments. Closes
   *  the reveal even for a proposal with no text at all (a `delete`) -
   *  without the done feed its animation entry stays "more may come" forever
   *  and the preview never becomes decidable. The final re-show without the
   *  streaming flag is the caller's ordinary completed-turn path (ChatBody's
   *  afterSend), not the machine's. */
  finalCall(callId: string, argumentsJson: string): void {
    const draft = this.drafts.get(callId);
    this.drafts.delete(callId);
    const proposal = parseProposal(argumentsJson);
    if (!proposal) {
      // Final args that don't validate can never be applied; a preview left
      // behind would sit un-decidable forever.
      if (draft?.phase === "revealing") this.effects.discard(callId);
      return;
    }
    this.effects.feed(callId, proposal.text ?? "", true);
  }

  /** The exchange ended without a finalCall for whatever is still here. A
   *  normal completion leaves the machine empty (every call got its
   *  finalCall), so this only ever acts on interrupted drafts. */
  finish(outcome: "stopped" | "failed"): void {
    for (const [callId, draft] of this.drafts) {
      if (draft.phase !== "revealing") continue; // nothing ever shown
      const parsed = outcome === "stopped" ? draftProposal(draft.args) : null;
      if (parsed) {
        this.effects.feed(callId, parsed.proposal.text ?? "", true);
        this.effects.finalize(callId, parsed.proposal);
      } else {
        this.effects.discard(callId);
      }
    }
    this.drafts.clear();
  }
}
