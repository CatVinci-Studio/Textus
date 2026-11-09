import { useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "../../ui/Tooltip";
import { FlipOnChange } from "../../ui/flip";
import { InlineMarkdownText } from "../MarkdownText";
import type { AgentTurn } from "../types";

export interface Comment {
  anchor: string;
  comment: string;
  block?: string;
  /** The passage (`anchor`, or the whole block) as it would read fixed:
   *  one click makes it a proposal. */
  suggestion?: string;
}

/** What a comment's suggested fix calls back with. */
export type ApplySuggestion = (callId: string, comment: Comment) => void;

/** An add_comment call's arguments: one of a reply's comments, each a call
 *  of its own. */
export function parseComment(argumentsJson: string): Comment | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed.anchor !== "string" || typeof parsed.comment !== "string")
      return null;
    return {
      anchor: parsed.anchor,
      comment: parsed.comment,
      block: typeof parsed.block === "string" ? parsed.block : undefined,
      suggestion:
        typeof parsed.suggestion === "string" && parsed.suggestion.trim()
          ? parsed.suggestion
          : undefined,
    };
  } catch {
    return null;
  }
}

/** A note's suggested fix, and the button that proposes it. */
function SuggestedFix({
  id,
  comment,
  labels,
  onApply,
}: {
  id: string;
  comment: Comment;
  labels: { commentApplySuggestion: string };
  onApply?: ApplySuggestion;
}) {
  if (!comment.suggestion) return null;
  return (
    <div className="agent-comment-suggestion">
      <InlineMarkdownText text={comment.suggestion} />
      {onApply && (
        <button
          type="button"
          className="tx-button small"
          onClick={() => onApply(id, comment)}
        >
          {labels.commentApplySuggestion}
        </button>
      )}
    </div>
  );
}

/** A review note in the conversation: the passage it is about, the note,
 *  and the way to it in the document. */
export function CommentCard({
  id,
  comment,
  num,
  reveal,
  style,
  labels,
  onLocateText,
  onApplySuggestion,
}: {
  id: string;
  comment: Comment;
  /** Its badge's number where the text shows notes as badges. */
  num: number | null;
  reveal: boolean;
  style: CSSProperties | undefined;
  labels: {
    commentTitle: string;
    commentLocate: string;
    commentApplySuggestion: string;
  };
  onLocateText?: (anchor: string, block?: string) => void;
  onApplySuggestion?: ApplySuggestion;
}) {
  return (
    <div
      className={`agent-comment${reveal ? " turn-reveal" : ""}`}
      style={style}
    >
      <div className="agent-proposal-head">
        {/* Where the text shows the note as a numbered badge, the card
            wears the same number in its place. */}
        {num !== null ? (
          <span className="agent-comment-num">{num}</span>
        ) : (
          <span className="agent-comment-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />
            </svg>
          </span>
        )}
        <span className="agent-proposal-title">{labels.commentTitle}</span>
        {onLocateText && (
          <button
            type="button"
            className="agent-proposal-link agent-proposal-show"
            onClick={() => onLocateText(comment.anchor, comment.block)}
          >
            {labels.commentLocate}
          </button>
        )}
      </div>
      <blockquote className="agent-comment-quote">{comment.anchor}</blockquote>
      <div className="agent-comment-text">
        <InlineMarkdownText text={comment.comment} />
      </div>
      <SuggestedFix id={id} comment={comment} labels={labels} onApply={onApplySuggestion} />
    </div>
  );
}

/** Notes a group shows before "Show N more". */
const FOLDED_NOTES = 3;

/** What follows `el` in its list - what its growing moves. */
function following(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let next = el?.nextElementSibling; next; next = next.nextElementSibling)
    out.push(next);
  return out;
}

/**
 * The notes one reply pinned, as one card: a row per note, the first few
 * shown and the rest behind "Show N more". One note alone keeps its own card.
 */
export function CommentGroup({
  items,
  reveal,
  style,
  labels,
  onLocateText,
  onApplySuggestion,
}: {
  items: { id: string; comment: Comment; num: number | null }[];
  reveal: boolean;
  style: CSSProperties | undefined;
  labels: {
    commentTitle: string;
    commentLocate: string;
    commentCount: string;
    commentGroupMore: string;
    proposalGroupLess: string;
    commentApplySuggestion: string;
  };
  onLocateText?: (anchor: string, block?: string) => void;
  onApplySuggestion?: ApplySuggestion;
}) {
  const [unfolded, setUnfolded] = useState(false);
  // A note arriving, or the card opening, slides what is below it to its
  // new place rather than jumping it.
  const ref = useRef<HTMLDivElement>(null);
  const rows = unfolded ? items : items.slice(0, FOLDED_NOTES);
  const hidden = items.length - rows.length;
  return (
    <div
      ref={ref}
      className={`agent-comment agent-comment-group${reveal ? " turn-reveal" : ""}`}
      style={style}
    >
      <FlipOnChange
        watch={`${unfolded}:${items.length}`}
        targets={() => following(ref.current)}
      />
      <div className="agent-proposal-head">
        <span className="agent-comment-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />
          </svg>
        </span>
        <span className="agent-proposal-title">
          {labels.commentTitle}
          <span className="agent-proposal-kind">
            {" · "}
            {labels.commentCount.replace("{n}", String(items.length))}
          </span>
        </span>
      </div>
      <ol className="agent-comment-rows">
        {rows.map(({ id, comment, num }) => (
          <li key={id} className="agent-comment-row">
            <Tooltip text={labels.commentLocate}>
              <button
                type="button"
                className="agent-comment-row-quote"
                disabled={!onLocateText}
                onClick={() => onLocateText?.(comment.anchor, comment.block)}
              >
                {num !== null && (
                  <span className="agent-comment-num">{num}</span>
                )}
                <span className="agent-comment-row-anchor">
                  {comment.anchor}
                </span>
              </button>
            </Tooltip>
            <div className="agent-comment-text">
              <InlineMarkdownText text={comment.comment} />
            </div>
            <SuggestedFix
              id={id}
              comment={comment}
              labels={labels}
              onApply={onApplySuggestion}
            />
          </li>
        ))}
      </ol>
      {items.length > FOLDED_NOTES && (
        <button
          type="button"
          className="agent-proposal-group-fold"
          aria-expanded={unfolded}
          onClick={() => setUnfolded(!unfolded)}
        >
          {unfolded
            ? labels.proposalGroupLess
            : labels.commentGroupMore.replace("{n}", String(hidden))}
        </button>
      )}
    </div>
  );
}

/** The notes of each run of add_comment calls in `turns` - calls in a row,
 *  their results between them - by the run's first call, the others
 *  mapped to none: all of a reply's notes are one card. */
export function noteRunsOf(
  turns: readonly AgentTurn[],
  noteNumber?: (id: string) => number | null,
): Map<string, { id: string; comment: Comment; num: number | null }[]> {
  const runs = new Map<
    string,
    { id: string; comment: Comment; num: number | null }[]
  >();
  let first: string | null = null;
  for (const turn of turns) {
    if (turn.kind === "ToolResult") continue;
    if (turn.kind !== "ToolCall" || turn.name !== "add_comment") {
      first = null;
      continue;
    }
    const comment = parseComment(turn.arguments);
    const notes = comment
      ? [
          {
            id: turn.call_id,
            comment,
            num: noteNumber?.(turn.call_id) ?? null,
          },
        ]
      : [];
    if (first === null) {
      first = turn.call_id;
      runs.set(first, notes);
    } else {
      runs.get(first)!.push(...notes);
      runs.set(turn.call_id, []);
    }
  }
  return runs;
}
