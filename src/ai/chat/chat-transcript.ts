import type { AgentTurn, EditProposal } from "../types";
import { isProposalTool, parseToolProposal } from "./proposal";
import { parseUserMessage } from "./user-message";
import { refusedProposalIds } from "../revision/proposal-status";
import { parseRememberResult, type RememberResult } from "./MemoryChip";
import { proposalRuns } from "./ProposalGroup";
import { noteRunsOf } from "./CommentCard";
import { memoryRunsOf } from "./memory-pass";
import { OFFER_SKILL, parseSkillOffer } from "./SkillOfferChip";
import { PAPER_TURN, parsePaperCard } from "../paper/paper-store";
import { OUT_OF_STEPS } from "./out-of-steps";
import { fileRunsOf, type FileChangeCall } from "./file-changes";

/**
 * A conversation's turns read for the panel: which tool calls are edit
 * proposals, notes, memories, a paper, a skill offered, and how several in a
 * row show as one card. Then each turn's item - what it shows as, or nothing.
 */

/** A proposal, and the selection its request went out with: the live one
 *  is gone once the caret moves, and the card would count all addition. */
export interface ParsedProposal {
  proposal: EditProposal | null;
  sentSelection: string | null;
}

export interface Transcript {
  proposals: Map<string, ParsedProposal>;
  /** What each remember call saved. */
  remembered: Map<string, RememberResult>;
  /** One exchange's memories together under its first (the others none). */
  memoryRuns: Map<string, string[]>;
  /** Calls the backend refused: never proposals, the model resends them. */
  refused: Set<string>;
  /** Proposals in a row: one card under the first. */
  proposalRuns: Map<string, string[]>;
  /** A reply's notes, one call or several in a row, as one card under its
   *  first call (an empty list under the others). */
  noteRuns: ReturnType<typeof noteRunsOf>;
  /** The picture requests, by call: the arguments a failed one is told by. */
  imageCalls: Map<string, string>;
  /** A reply's changes to the folder's files, as one card under its first
   *  (an empty list under the others). */
  fileRuns: Map<string, FileChangeCall[]>;
}

export function readTranscript(
  turns: AgentTurn[],
  noteNumber?: (id: string) => number | null,
): Transcript {
  const proposals = new Map<string, ParsedProposal>();
  const remembers = new Set<string>();
  const imageCalls = new Map<string, string>();
  let sentSelection: string | null = null;
  for (const turn of turns) {
    if (turn.kind === "User")
      sentSelection = parseUserMessage(turn.text).selection;
    if (turn.kind !== "ToolCall") continue;
    if (isProposalTool(turn.name))
      proposals.set(turn.call_id, {
        proposal: parseToolProposal(turn.name, turn.arguments),
        sentSelection,
      });
    else if (turn.name === "remember") remembers.add(turn.call_id);
    // A picture is a proposal too: kept by its arguments as well, for the
    // line a refused one shows.
    if (turn.name === "generate_image")
      imageCalls.set(turn.call_id, turn.arguments);
  }
  const remembered = new Map<string, RememberResult>();
  for (const turn of turns) {
    if (turn.kind !== "ToolResult" || !remembers.has(turn.call_id)) continue;
    const result = parseRememberResult(turn.output);
    if (result) remembered.set(turn.call_id, result);
  }
  const refused = refusedProposalIds(turns);
  return {
    proposals,
    remembered,
    memoryRuns: memoryRunsOf(turns, remembered),
    refused,
    proposalRuns: proposalRuns(turns, proposals, refused),
    noteRuns: noteRunsOf(turns, noteNumber),
    imageCalls,
    fileRuns: fileRunsOf(turns),
  };
}

/** What one turn shows as in the panel. */
export type ChatItem =
  | { kind: "none" }
  /** A picture that wasn't made, where the user has something to do. */
  | { kind: "notMade"; arguments: string }
  /** A proposal its card can't read: shown as the call it is. */
  | { kind: "call"; turn: AgentTurn }
  | { kind: "proposal"; callId: string; parsed: ParsedProposal }
  | { kind: "proposals"; callIds: string[] }
  | {
      kind: "notes";
      run: Transcript["noteRuns"] extends Map<string, infer R> ? R : never;
    }
  | {
      kind: "skillOffer";
      offer: NonNullable<ReturnType<typeof parseSkillOffer>>;
    }
  | { kind: "paper"; info: NonNullable<ReturnType<typeof parsePaperCard>> }
  | { kind: "memories"; callIds: string[] }
  | { kind: "files"; run: FileChangeCall[] }
  /** The model stopped at its step limit. */
  | { kind: "stopped" }
  /** A plain turn: the user's, a reply, a step. */
  | { kind: "turn"; turn: AgentTurn };

const NONE: ChatItem = { kind: "none" };

export function itemOf(turn: AgentTurn, t: Transcript): ChatItem {
  if (turn.kind === "ToolCall" || turn.kind === "ToolResult") {
    const id = turn.call_id;
    if (t.refused.has(id))
      return turn.kind === "ToolResult" && t.imageCalls.has(id)
        ? { kind: "notMade", arguments: t.imageCalls.get(id) ?? "" }
        : NONE;
  }
  if (turn.kind === "ToolCall") {
    const id = turn.call_id;
    if (isProposalTool(turn.name)) {
      const parsed = t.proposals.get(id);
      if (!parsed?.proposal) return { kind: "call", turn };
      const run = t.proposalRuns.get(id);
      if (run) return { kind: "proposals", callIds: run };
      const inRun = [...t.proposalRuns.values()].some((r) => r.includes(id));
      return inRun ? NONE : { kind: "proposal", callId: id, parsed };
    }
    if (turn.name === "add_comment" && t.noteRuns.has(id)) {
      const run = t.noteRuns.get(id)!;
      return run.length ? { kind: "notes", run } : NONE;
    }
    if (t.fileRuns.has(id)) {
      const run = t.fileRuns.get(id)!;
      return run.length ? { kind: "files", run } : NONE;
    }
    // Shown by their results.
    if ([OFFER_SKILL, PAPER_TURN, "remember"].includes(turn.name)) return NONE;
  }
  if (turn.kind === "ToolResult") {
    const id = turn.call_id;
    // A proposal's or a note's card is its result.
    if (t.proposals.has(id) || t.noteRuns.has(id) || t.fileRuns.has(id))
      return NONE;
    const offer =
      id.startsWith(`${OFFER_SKILL}-`) && parseSkillOffer(turn.output);
    if (offer) return { kind: "skillOffer", offer };
    const paper = parsePaperCard(id, turn.output);
    if (paper) return { kind: "paper", info: paper };
    // A remember that saved nothing (a duplicate) shows as any result.
    if (t.remembered.has(id)) {
      const run = t.memoryRuns.get(id);
      return run ? { kind: "memories", callIds: run } : NONE;
    }
  }
  if (turn.kind === "Assistant" && turn.text === OUT_OF_STEPS)
    return { kind: "stopped" };
  return { kind: "turn", turn };
}
