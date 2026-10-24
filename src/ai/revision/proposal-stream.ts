import { draftProposal, parsePartialToolArgs } from "../chat/partial-tool-args";
import { draftPictureProposal } from "./generated-images";
import { resolveBlockTarget, type SentBlock } from "../doc-blocks";
import type { PartialString } from "../chat/partial-tool-args";
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
  /** A generate_image call: its frame shows where it goes, the picture
   *  follows with the completed call (draftPictureProposal). */
  picture?: boolean;
}

export class ProposalStream {
  private drafts = new Map<string, Draft>();
  /** Completed calls waiting for their result (`result`). */
  private awaiting = new Set<string>();

  constructor(
    private effects: ProposalStreamEffects,
    /** The document's blocks now, for a draft that names its block
     *  (doc-blocks.ts): it is placed as soon as the block is named. */
    private documentNow?: () => SentBlock[],
  ) {}

  /** A tool call opened - propose_edit and generate_image enter the
   *  machine. */
  toolStart(callId: string, toolName: string): void {
    // Said again for a call already here - images.rs' execute announces
    // the picture it runs - it is the same call: a fresh draft in its
    // place left the frame placed from the stream un-discardable, and the
    // picture's proposal "Writing…" for good, never in the text (rc.6).
    if (this.drafts.has(callId)) return;
    if (toolName === "propose_edit")
      this.drafts.set(callId, { phase: "drafting", args: "" });
    else if (toolName === "generate_image")
      this.drafts.set(callId, { phase: "drafting", args: "", picture: true });
  }

  /** An argument fragment arrived. Places the preview the first time the
   *  accumulated args parse far enough to locate (partial-tool-args), and
   *  feeds the typewriter from then on. */
  argsDelta(callId: string, delta: string): void {
    const draft = this.drafts.get(callId);
    if (!draft) return;
    draft.args += delta;
    if (draft.picture) {
      if (draft.phase === "revealing") return;
      const proposal = draftPictureProposal(
        callId,
        byBlock(parsePartialToolArgs(draft.args), this.documentNow?.()),
      );
      if (!proposal) return;
      draft.phase = "revealing";
      this.effects.place(callId, proposal);
      this.effects.feed(callId, proposal.text ?? "", true);
      return;
    }
    const parsed = draftProposal(draft.args, this.documentNow?.());
    if (!parsed) return;
    if (draft.phase === "drafting") {
      draft.phase = "revealing";
      this.effects.place(callId, parsed.proposal);
    }
    // Its text whole - the closing quote in - it lands now, not when the
    // step ends: a reply's edits stream one after another (agent/
    // lists.rs), and the step's turns come only after the last.
    this.effects.feed(callId, parsed.proposal.text ?? "", parsed.textComplete);
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
    this.awaiting.add(callId);
    if (draft?.picture) {
      // The frame goes; the picture's own proposal (ChatBody's
      // completed-turn path, right after this) is placed in its stead - a
      // final add over a streaming one keeps its text, and this one's
      // names another picture. One that made none leaves nothing.
      if (draft.phase === "revealing") this.effects.discard(callId);
      return;
    }
    const proposal = parseProposal(argumentsJson);
    if (!proposal) {
      // Final args that don't validate can never be applied; a preview left
      // behind would sit un-decidable forever.
      if (draft?.phase === "revealing") this.effects.discard(callId);
      return;
    }
    this.effects.feed(callId, proposal.text ?? "", true);
  }

  /** A completed call's result came. One the backend refused (tools.rs:
   *  a cut-off `text`, isRefusal) may already be on screen - streamed, or
   *  placed from its completed call a moment before - and goes, with or
   *  without animation; the model sends it again, fixed. */
  result(callId: string, refused: boolean): void {
    if (!this.awaiting.delete(callId)) return;
    if (refused) this.effects.discard(callId);
  }

  /** The exchange ended without a finalCall for whatever is still here. A
   *  normal completion leaves the machine empty (every call got its
   *  finalCall), so this only ever acts on interrupted drafts. */
  finish(outcome: "stopped" | "failed"): void {
    for (const [callId, draft] of this.drafts) {
      if (draft.phase !== "revealing") continue; // nothing ever shown
      // A frame whose picture was never asked for has nothing to keep.
      if (draft.picture) {
        this.effects.discard(callId);
        continue;
      }
      const parsed =
        outcome === "stopped"
          ? draftProposal(draft.args, this.documentNow?.())
          : null;
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

/**
 * A picture call's fields with the block it names (doc-blocks.ts'
 * resolveBlockTarget) and its anchor, once that is complete - before, no
 * anchor, so the frame waits for it. Without a block, as they came.
 */
function byBlock(
  fields: Record<string, PartialString>,
  blocks: SentBlock[] | undefined,
): Record<string, PartialString> {
  const { block, anchor, ...rest } = fields;
  if (!block) return fields;
  if (!block.complete || blocks === undefined) return rest;
  const target = resolveBlockTarget(blocks, {
    block: block.value,
    anchor: anchor?.complete ? anchor.value : undefined,
  });
  if (!target?.block) return rest;
  return {
    ...rest,
    block: { value: target.block, complete: true },
    anchor: { value: target.anchor, complete: true },
  };
}
