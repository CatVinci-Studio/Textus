import type { CSSProperties } from "react";
import { InlineMarkdownText } from "../MarkdownText";

export interface Comment {
  anchor: string;
  comment: string;
  block?: string;
}

/** An add_comment call's arguments (src-tauri ai/tools.rs). */
export function parseComment(argumentsJson: string): Comment | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed.anchor !== "string" || typeof parsed.comment !== "string")
      return null;
    return {
      anchor: parsed.anchor,
      comment: parsed.comment,
      block: typeof parsed.block === "string" ? parsed.block : undefined,
    };
  } catch {
    return null;
  }
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
