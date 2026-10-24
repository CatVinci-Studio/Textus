import { useRef, useState, type CSSProperties } from "react";
import { FlipOnChange } from "../../ui/flip";
import { InlineMarkdownText } from "../MarkdownText";

export interface Comment {
  anchor: string;
  comment: string;
  block?: string;
}

/** One of an add_comment call's comments, as Rust resolved it (its
 *  passage's text in `anchor`); null when it isn't one. */
export function commentOf(item: unknown): Comment | null {
  if (!item || typeof item !== "object") return null;
  const { anchor, comment, block } = item as Record<string, unknown>;
  if (typeof anchor !== "string" || typeof comment !== "string") return null;
  return {
    anchor,
    comment,
    block: typeof block === "string" ? block : undefined,
  };
}

/** An add_comment call's comments (src-tauri ai/tools/folder.rs): all of a
 *  reply's points in its `comments`, or - in a conversation from before
 *  1.2.1 - the one it pinned. */
export function parseComments(argumentsJson: string): Comment[] {
  try {
    const parsed = JSON.parse(argumentsJson);
    const items: unknown[] = Array.isArray(parsed.comments)
      ? parsed.comments
      : [parsed];
    return items.flatMap((item) => commentOf(item) ?? []);
  } catch {
    return [];
  }
}

/** A comment's id - its note's in the text and margin: its call's, and
 *  its place among the call's comments. */
export function commentId(callId: string, index: number): string {
  return `${callId}:${index}`;
}

/** A review note in the conversation: the passage it is about, the note,
 *  and the way to it in the document. */
export function CommentCard({
  comment,
  num,
  reveal,
  style,
  labels,
  onLocateText,
}: {
  comment: Comment;
  /** Its badge's number where the text shows notes as badges. */
  num: number | null;
  reveal: boolean;
  style: CSSProperties | undefined;
  labels: { commentTitle: string; commentLocate: string };
  onLocateText?: (anchor: string, block?: string) => void;
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
 * The notes one reply pinned, as one card: as cards of their own, forty
 * words glossed ran on for screens. Each note a row - the words it is
 * about, then the note - its first few shown and the rest behind "Show N
 * more", as a group of proposals folds (ProposalGroup). A row takes you to
 * its passage. One note alone keeps its own card.
 */
export function CommentGroup({
  items,
  reveal,
  style,
  labels,
  onLocateText,
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
  };
  onLocateText?: (anchor: string, block?: string) => void;
}) {
  const [unfolded, setUnfolded] = useState(false);
  // A note arriving, or the card opening, slides what is below it to its
  // new place rather than jumping it (FlipOnChange).
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
            <button
              type="button"
              className="agent-comment-row-quote"
              title={labels.commentLocate}
              disabled={!onLocateText}
              onClick={() => onLocateText?.(comment.anchor, comment.block)}
            >
              {num !== null && <span className="agent-comment-num">{num}</span>}
              <span className="agent-comment-row-anchor">{comment.anchor}</span>
            </button>
            <div className="agent-comment-text">
              <InlineMarkdownText text={comment.comment} />
            </div>
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
