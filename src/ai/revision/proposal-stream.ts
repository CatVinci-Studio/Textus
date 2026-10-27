import { draftProposal, parsePartialToolArgs } from "../chat/partial-tool-args";
import { draftPictureProposal } from "./generated-images";
import { resolveBlockTarget, type SentBlock } from "../doc-blocks";
import type { PartialString } from "../chat/partial-tool-args";
import { parseProposal } from "../chat/proposal";
import type { EditProposal } from "../types";

/** The writing-phase state machine for streamed proposal calls. A stop keeps
 *  what streamed, made decidable; a failure discards it, as Retry would
 *  duplicate it. */
export interface ProposalStreamEffects {
  /** First moment the draft can be located: show it as a streaming
   *  (un-decidable) preview at its anchor. */
  place(callId: string, proposal: EditProposal): void;
  /** Text for the typewriter so far; `done` lets the reveal settle. `final`
   *  (default with `done`): the call's own arguments are in, which the
   *  preview needs before it is decidable. */
  feed(callId: string, text: string, done: boolean, final?: boolean): void;
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
   *  follows with the completed call. */
  picture?: boolean;
}

export class ProposalStream {
  private drafts = new Map<string, Draft>();
  /** Completed calls waiting for their result (`result`). */
  private awaiting = new Set<string>();

  constructor(
    private effects: ProposalStreamEffects,
    /** The document's blocks now, so a draft naming its block is placed as
     *  soon as it is named. */
    private documentNow?: () => SentBlock[],
  ) {}

  /** A tool call opened - propose_edit and generate_image enter the
   *  machine. */
  toolStart(callId: string, toolName: string): void {
    // The backend announces a running picture again: the same call, and a
    // fresh draft would leave the placed frame un-discardable.
    if (this.drafts.has(callId)) return;
    if (toolName === "propose_edit")
      this.drafts.set(callId, { phase: "drafting", args: "" });
    else if (toolName === "generate_image")
      this.drafts.set(callId, { phase: "drafting", args: "", picture: true });
  }

  /** An argument fragment arrived. Places the preview once the args parse
   *  far enough to locate, and feeds the typewriter from then on. */
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
    // Its text whole, it lands now: the step's turns come only after a
    // reply's last edit.
    this.effects.feed(
      callId,
      parsed.proposal.text ?? "",
      parsed.textComplete,
      false,
    );
  }

  /** The completed call's authoritative arguments. Closes the reveal even
   *  for a proposal with no text, or it would never become decidable. */
  finalCall(callId: string, argumentsJson: string): void {
    const draft = this.drafts.get(callId);
    this.drafts.delete(callId);
    this.awaiting.add(callId);
    if (draft?.picture) {
      // The frame goes; the picture's own proposal, placed right after,
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

  /** A completed call's result came. One the backend refused may already be
   *  on screen, and goes; the model sends it again, fixed. */
  result(callId: string, refused: boolean): void {
    if (!this.awaiting.delete(callId)) return;
    if (refused) this.effects.discard(callId);
  }

  /** The exchange ended; only interrupted drafts are still here. */
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

/** A picture call's fields with its named block resolved, once complete;
 *  until then no anchor, so the frame waits. */
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
