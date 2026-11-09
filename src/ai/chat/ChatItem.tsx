import { createContext, Suspense, useContext, type CSSProperties } from "react";
import { AgentTurnView } from "./AgentTurnView";
import { ThoughtRow } from "./ThoughtRow";
import { MemoryChip } from "./MemoryChip";
import { ProposalCard, notMadeLine } from "./ProposalCard";
import { ProposalGroup } from "./ProposalGroup";
import { CommentCard, CommentGroup } from "./CommentCard";
import { SkillOfferChip } from "./SkillOfferChip";
import { FileChangesCard } from "./FileChangesCard";
import { PaperCard } from "../paper/lazy";
import type { ChatItem as Item, Transcript } from "./chat-transcript";
import type { ChatMessagesProps } from "./chat-messages-types";
import type { Thought } from "./thought";
import "../revision/pending-picture.css";

/**
 * One item of the conversation, drawn as its kind is: a proposal's card or
 * a run of them, notes, memories, a paper, a skill offered, the step limit,
 * or a plain turn with its thinking. What every item needs - the words, the
 * actions on proposals and notes - comes from the list, not through each.
 */

export interface ChatItemsContext extends Pick<
  ChatMessagesProps,
  | "labels"
  | "busy"
  | "selectedText"
  | "proposalStatus"
  | "onAcceptProposal"
  | "onRejectProposal"
  | "onRelocateProposal"
  | "proposalSentences"
  | "onDecideSentence"
  | "onRevealProposal"
  | "onLocateText"
  | "onApplySuggestion"
  | "onContinue"
> {
  proposalActions: boolean;
  docPath: string | null;
  transcript: Transcript;
  /** The conversation, whose file changes the cards undo and apply. */
  conversation: string;
}

export const ChatItems = createContext<ChatItemsContext | null>(null);

/** How the item comes in: whether it fades in, and its place in the
 *  stagger. */
export interface Arrival {
  reveal: boolean;
  style: CSSProperties | undefined;
}

export function ChatItem({
  item,
  arrival,
  thought,
  last,
}: {
  item: Item;
  arrival: Arrival;
  /** A user turn's thinking, shown under it. */
  thought: Thought | null;
  /** The last of the conversation: the step limit offers Continue there. */
  last: boolean;
}) {
  const c = useContext(ChatItems)!;
  const { labels } = c;
  const { reveal, style } = arrival;
  const revealed = (extra = "") =>
    `${extra}${reveal ? " turn-reveal" : ""}`.trim() || undefined;
  // While a request runs, a card can render a beat before its preview is
  // registered: still arriving, not expired.
  const statusOf = (id: string) => {
    const known = c.proposalStatus(id);
    return known === "expired" && c.busy ? "streaming" : known;
  };
  switch (item.kind) {
    case "none":
      return null;
    case "notMade": {
      const line = notMadeLine(item.arguments, labels);
      return line ? (
        <div
          className={revealed("agent-tool-line agent-image-failed")}
          style={style}
        >
          {line}
        </div>
      ) : null;
    }
    case "call":
      return <AgentTurnView turn={item.turn} labels={labels} />;
    case "proposals":
      return (
        <ProposalGroup
          items={item.callIds.map((id) => ({
            callId: id,
            proposal: c.transcript.proposals.get(id)!.proposal!,
            status: statusOf(id),
          }))}
          // Its first row was a card a moment ago: it takes that card's
          // place, not fading in from nothing again.
          reveal={false}
          style={style}
          labels={labels}
          actions={c.proposalActions}
          onAccept={c.onAcceptProposal}
          onReject={c.onRejectProposal}
          onReveal={c.onRevealProposal}
        />
      );
    case "proposal": {
      const status = statusOf(item.callId);
      return (
        <ProposalCard
          callId={item.callId}
          proposal={item.parsed.proposal!}
          status={status}
          reveal={reveal}
          style={style}
          selectedText={item.parsed.sentSelection ?? c.selectedText}
          labels={labels}
          sentences={
            status === "pending"
              ? (c.proposalSentences?.(item.callId) ?? null)
              : null
          }
          onDecide={c.onDecideSentence}
          onReveal={c.onRevealProposal}
          onAccept={c.onAcceptProposal}
          onReject={c.onRejectProposal}
          onRelocate={c.onRelocateProposal}
          actions={c.proposalActions}
        />
      );
    }
    case "notes":
      return item.run.length === 1 ? (
        <CommentCard
          id={item.run[0].id}
          comment={item.run[0].comment}
          num={item.run[0].num}
          reveal={reveal}
          style={style}
          labels={labels}
          onLocateText={c.onLocateText}
          onApplySuggestion={c.onApplySuggestion}
        />
      ) : (
        <CommentGroup
          items={item.run}
          reveal={reveal}
          style={style}
          labels={labels}
          onLocateText={c.onLocateText}
          onApplySuggestion={c.onApplySuggestion}
        />
      );
    case "files":
      return (
        <FileChangesCard
          run={item.run}
          conversation={c.conversation}
          reveal={reveal}
          style={style}
          labels={labels}
        />
      );
    case "skillOffer":
      return (
        <div className={revealed("agent-memory-group")} style={style}>
          <SkillOfferChip offer={item.offer} docPath={c.docPath} />
        </div>
      );
    case "paper":
      return (
        <div className={revealed()} style={style}>
          <Suspense fallback={null}>
            <PaperCard info={item.info} />
          </Suspense>
        </div>
      );
    case "memories":
      return (
        <div className={revealed("agent-memory-group")} style={style}>
          {item.callIds.map((id) => (
            <MemoryChip
              key={id}
              result={c.transcript.remembered.get(id)!}
              docPath={c.docPath}
              labels={labels}
            />
          ))}
        </div>
      );
    case "stopped":
      return (
        <div className={revealed("agent-stopped")} style={style}>
          <span>{labels.stoppedAtLimit}</span>
          {c.onContinue && !c.busy && last && (
            <button
              type="button"
              className="inline-chat-action agent-stopped-continue"
              onClick={c.onContinue}
            >
              {labels.continueAfterLimit}
            </button>
          )}
        </div>
      );
    case "turn":
      return (
        <>
          <div className={revealed()} style={style}>
            <AgentTurnView turn={item.turn} labels={labels} />
          </div>
          {thought && <ThoughtRow thought={thought} labels={labels} />}
        </>
      );
  }
}
