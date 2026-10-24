import { memo } from "react";
import type { ReviewNote } from "./review-notes-plugin";
import { CARD_WIDTH } from "./margin-room";
import {
  CHIP_HEIGHT,
  type MarginItem,
  type ReviewMarginLabels,
} from "./margin-layout";
import { NoteCard, RevisionCard } from "./MarginCards";
import "./ReviewMargin.css";

/** A group's line: how many notes and changes it holds. */
function groupLabel(items: MarginItem[], labels: ReviewMarginLabels): string {
  const notes = items.filter((i) => i.kind === "note").length;
  const changes = items.length - notes;
  return [
    notes > 0 && labels.reviewGroupNotes.replace("{n}", String(notes)),
    changes > 0 && labels.proposalChangeCount.replace("{n}", String(changes)),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a closed group's chip shows under its heading: its first card's
 *  words, as each chip shows its own. */
function groupGlimpse(items: MarginItem[]): string {
  const first = items[0];
  if (!first) return "";
  return first.kind === "note"
    ? first.note.comment
    : (first.shows === "new" ? first.before : first.after)
        .trim()
        .replace(/^#{1,6}\s+/, "");
}

/**
 * A run with more notes than its paragraph has lines (stackCards' group):
 * one chip, "8 notes", which opens - clicked, one of its own pointed at by
 * a bar, or while picking - to the list of its cards over the margin
 * below, none of the other cards moved. Each card in the list lights its
 * passage as one in the margin does.
 */
export const MarginGroup = memo(function MarginGroup({
  groupKey,
  items,
  open,
  onOpen,
  picked,
  onPick,
  hot,
  focused,
  labels,
  top,
  left,
  onHot,
  onDone,
  onAsk,
  onEdit,
  onDecide,
}: {
  groupKey: string;
  items: MarginItem[];
  open: boolean;
  onOpen: (key: string | null) => void;
  picked: ReadonlySet<string> | null;
  onPick: (id: string) => void;
  hot: string | null;
  focused: string | null;
  labels: ReviewMarginLabels;
  top: number;
  left: number;
  onHot: (key: string, on: boolean) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
}) {
  const noHeight = () => {};
  return (
    <div
      className={`review-note review-note-group${open ? " review-note-cut-open review-note-group-open" : " review-note-chip"}`}
      style={{
        top,
        left,
        width: CARD_WIDTH,
        height: open ? undefined : CHIP_HEIGHT,
      }}
    >
      <button
        type="button"
        className="review-note-group-head"
        aria-expanded={open}
        onClick={() => onOpen(open ? null : groupKey)}
        data-group={groupKey}
      >
        <span className="review-note-by">
          <span className="review-note-mark" aria-hidden="true">
            AI
          </span>
          {groupLabel(items, labels)}
        </span>
        {!open && (
          <span className="review-note-chip-text">{groupGlimpse(items)}</span>
        )}
      </button>
      {open && (
        <div className="review-note-group-list">
          {items.map((item) =>
            item.kind === "note" ? (
              <NoteCard
                key={item.key}
                itemKey={item.key}
                note={item.note}
                hot={hot === item.key}
                picked={picked ? picked.has(item.note.id) : null}
                onPick={onPick}
                open
                onOpen={onOpen}
                cut={null}
                chip={false}
                labels={labels}
                top={null}
                left={left}
                onHot={onHot}
                onDone={onDone}
                onAsk={onAsk}
                onEdit={onEdit}
                onHeight={noHeight}
              />
            ) : (
              <RevisionCard
                key={item.key}
                item={item}
                hot={hot === item.key}
                focused={focused === item.key}
                open
                onOpen={onOpen}
                cut={null}
                chip={false}
                labels={labels}
                top={null}
                left={left}
                onHot={onHot}
                onDecide={onDecide}
                onHeight={noHeight}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
});
