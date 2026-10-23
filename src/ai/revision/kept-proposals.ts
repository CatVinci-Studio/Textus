import type { EditProposal } from "../types";
import { generatedIdsIn } from "./generated-images";
import type { SelectionTarget } from "./pending-place";
import type { PendingPreview } from "./pending-types";

/**
 * The proposals the writer hasn't decided on, as they are kept with the
 * document (ai/kept_proposals.rs: the project's `.textus/pending/`, or the
 * app's data folder) and offered again when it opens. Each is kept as it
 * was proposed: anchored by its blocks' ids (doc-blocks.ts), a hash of
 * their text, it lands where it did while those blocks read as they did,
 * and gives way when they don't. A selection's or the caret's proposal
 * keeps where that was, and comes back only to the document it was made
 * for, unchanged. A picture still waiting in the backend isn't kept: it
 * doesn't outlive the app.
 */

export const KEPT_VERSION = 1;

export interface KeptProposal {
  callId: string;
  proposal: EditProposal;
  /** What replace_selection or insert_at_cursor wrote to. */
  target?: SelectionTarget;
  /** The writer's call on each of its sentences so far. */
  takes?: (boolean | null)[];
}

export interface KeptProposals {
  version: number;
  /** A hash of the document's markdown when they were kept: where a
   *  position-bound proposal may come back. */
  document: number;
  proposals: KeptProposal[];
}

/** Whether a proposal in the document can be kept: decidable, and with no
 *  picture that lives only in this run of the app. */
export function keepable(preview: PendingPreview): boolean {
  return (
    !preview.streaming &&
    !preview.proposal.image &&
    generatedIdsIn(preview.proposal.text ?? "").length === 0
  );
}

/** What to keep of the document's proposals, or null when nothing is left
 *  to decide. `selectionMarkdown` reads a range of the document as it is. */
export function keptFrom(
  previews: PendingPreview[],
  document: number,
  selectionMarkdown: (from: number, to: number) => string,
): KeptProposals | null {
  const proposals = previews.filter(keepable).map((p): KeptProposal => {
    const kept: KeptProposal = { callId: p.callId, proposal: p.proposal };
    if (p.proposal.action === "replace_selection")
      kept.target = {
        range: { from: p.from, to: p.to },
        selectionMarkdown: selectionMarkdown(p.from, p.to),
      };
    else if (p.proposal.action === "insert_at_cursor")
      kept.target = { range: null, selectionMarkdown: null, cursor: p.from };
    const takes = p.sentences?.changes.map((c) => c.take);
    if (takes?.some((take) => take !== null)) kept.takes = takes;
    return kept;
  });
  return proposals.length > 0
    ? { version: KEPT_VERSION, document, proposals }
    : null;
}

/** What was kept, if it reads as this version wrote it. */
export function readKept(value: unknown): KeptProposals | null {
  if (typeof value !== "object" || value === null) return null;
  const kept = value as Partial<KeptProposals>;
  if (kept.version !== KEPT_VERSION || !Array.isArray(kept.proposals))
    return null;
  const proposals = kept.proposals.filter(
    (p): p is KeptProposal =>
      typeof p?.callId === "string" && typeof p.proposal?.action === "string",
  );
  return {
    version: KEPT_VERSION,
    document: typeof kept.document === "number" ? kept.document : -1,
    proposals,
  };
}

/** The kept proposals that may come back to the document as it reads now
 *  (`document`, its hash): those bound to a position only to the same
 *  document. */
export function restorable(
  kept: KeptProposals,
  document: number,
): KeptProposal[] {
  return kept.proposals.filter((p) => !p.target || kept.document === document);
}
