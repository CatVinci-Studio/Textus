import { RevisionNoteText } from "./RevisionNoteText";
import { OWN_CHANGES } from "./own-revision-plugin";
import { InlineMarkdownText } from "../MarkdownText";
import { memo, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ReviewNote } from "./review-notes-plugin";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { animate } from "../../ui/motion";
import { joinBeat } from "../../ui/moves";
import { CARD_WIDTH } from "./margin-room";
import { Tooltip } from "../../ui/Tooltip";
import "./ReviewMargin.css";
import { type MarginItem, type ReviewMarginLabels } from "./margin-layout";
import { changeGlimpse } from "./change-glimpse";
import {
  blockNames,
  blockSummary,
  wholeBlockKind,
} from "../revision/markdown-forms";

/** A sentence as a card shows it on a line: a title's text without the
 *  `# ` that makes it one. */
function plainLine(text: string): string {
  return text.trim().replace(/^#{1,6}\s+/, "");
}

/** A change's new text on its card: a whole block other than a picture by
 *  what it is. */
function revisionText(after: string, labels: ReviewMarginLabels): string {
  const text = after.trim();
  if (wholeBlockKind(text) === "picture") return text;
  return blockSummary(text, blockNames(labels)) ?? text;
}

/** The margin's cards: revisions, notes, and the note popover a phone shows
 *  instead. */

export const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const CROSS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** What a card is told by the margin: where it sits, and the margin's
 *  callbacks, which keep their identity across renders. */
export interface CardPlace {
  hot: boolean;
  /** Its place in the margin, or null in a group's list. */
  top: CardSpot;
  /** The height it is cut to beside its passage, or null: it opens whole
   *  over the cards below while hot or focused. */
  cut: number | null;
  /** Cut to one line: a chip, its own short form. */
  chip: boolean;
  /** Opened by a click, or pointed at by a bar: a cut card is whole. */
  open: boolean;
  /** A click on a cut card opens it. */
  onOpen: (key: string | null) => void;
  labels: ReviewMarginLabels;
  left: number;
  onHot: (key: string, on: boolean) => void;
  onHeight: (key: string, height: number) => void;
}

/** A card's place: in the margin, absolute, or in a group's list, where
 *  it is laid out in turn (`top` null). */
type CardSpot = number | null;

/** Where a card stands, and the height it is cut to - or, opened, its
 *  whole height over the cards below, none of them moved. */
function cardStyle(
  top: CardSpot,
  left: number,
  cut: number | null,
  open: boolean,
) {
  if (top === null) return undefined;
  return {
    top,
    left,
    width: CARD_WIDTH,
    height: cut !== null && !open ? cut : undefined,
  };
}

/** A cut card's class: a chip, cut short, or opened whole above the rest. */
function cutClass(cut: number | null, chip: boolean, open: boolean): string {
  if (cut === null) return "";
  if (open) return " review-note-cut-open";
  return chip ? " review-note-chip" : " review-note-cut";
}

/** A card's box: its height for the stack, and its glide on `translate` so
 *  the margin is laid out once, not every frame. A cut card's height isn't
 *  reported, so one opened over the others doesn't restack them. */
export function useCardBox(
  key: string,
  top: CardSpot,
  onHeight: CardPlace["onHeight"],
  cut: boolean,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ onHeight, cut });
  latest.current = { onHeight, cut };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!latest.current.cut) latest.current.onHeight(key, el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  const glide = useRef<{
    top: number;
    from: number;
    animation: Animation | null;
  } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const last = glide.current;
    if (top === null) return;
    if (!el || !last) {
      glide.current = { top, from: 0, animation: null };
      return;
    }
    if (last.top === top) return;
    let from = last.top - top;
    const running = last.animation;
    if (running?.playState === "running") {
      const progress = running.effect?.getComputedTiming().progress ?? 1;
      from += last.from * (1 - progress);
      running.cancel();
    }
    glide.current = {
      top,
      from,
      animation: animate(
        el,
        [{ translate: `0 ${from}px` }, { translate: "0 0" }],
        { duration: "--dur-slow", easing: "--ease-spring" },
      ),
    };
  }, [top]);
  return ref;
}

export type RevisionItem = Extract<MarginItem, { kind: "revision" }>;

/** A changed sentence in the margin: what replaces it, and ✓ / ✕ - the same
 *  decision as the AI card's. A kept one dims, its replacement struck. */
export const RevisionCard = memo(
  function RevisionCard({
    item,
    hot,
    focused,
    open,
    onOpen,
    cut,
    chip,
    labels,
    top,
    left,
    onHot,
    onDecide,
    onHeight,
  }: CardPlace & {
    item: RevisionItem;
    focused: boolean;
    onDecide: (callId: string, index: number, take: boolean | null) => void;
  }) {
    const ref = useCardBox(item.key, top, onHeight, cut !== null);
    // It comes in on its change's beat, with its new text.
    useLayoutEffect(() => {
      if (ref.current) joinBeat(ref.current, item.key);
    }, [ref, item.key]);
    const state =
      item.take === false ? "kept" : item.take === true ? "taken" : "open";
    const closed = chip && !open;
    // What the card's text is, said in its heading; the text on the line
    // under it, a chip's too.
    const original = item.shows === "new" && !!item.before.trim();
    const what = original
      ? labels.proposalDeletedSentence
      : !item.before.trim() && item.after.trim()
        ? labels.proposalAddedSentence
        : null;
    return (
      <div
        ref={ref}
        className={`review-note revision-note revision-note-${state}${hot ? " review-note-hot" : ""}${focused ? " revision-note-focus" : ""}${item.streaming ? " revision-note-streaming" : ""}${cutClass(cut, chip, open)}`}
        role="group"
        aria-label={`${labels.reviewBarLabel} ${item.num}`}
        data-call={item.callId}
        style={cardStyle(top, left, cut, open)}
        onMouseEnter={() => onHot(item.key, true)}
        onMouseLeave={() => onHot(item.key, false)}
        // A click selects it: its sentence lit and brought into view, a
        // cut card opened whole - its own buttons aside.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) onOpen(item.key);
        }}
      >
        <div className="review-note-by">
          {/* The writer's own change: Me, not a number in the AI's review. */}
          {item.callId === OWN_CHANGES ? (
            <span
              className="review-note-mark review-note-mark-me"
              aria-hidden="true"
            >
              {labels.ownNoteMark}
            </span>
          ) : (
            <span className="revision-note-num" aria-hidden="true">
              {item.num}
            </span>
          )}
          <span className="revision-note-what">
            {what
              ? `${labels.reviewBarLabel} · ${what}`
              : labels.reviewBarLabel}
          </span>
          <span className="agent-proposal-pick revision-note-pick">
            <Tooltip text={labels.proposalTakeSentence}>
              <button
                type="button"
                className="pending-pick-take"
                aria-pressed={item.take === true}
                disabled={item.streaming}
                aria-label={labels.proposalTakeSentence}
                onClick={() =>
                  onDecide(
                    item.callId,
                    item.index,
                    item.take === true ? null : true,
                  )
                }
              >
                {CHECK}
              </button>
            </Tooltip>
            <Tooltip text={labels.proposalKeepSentence}>
              <button
                type="button"
                className="pending-pick-keep"
                aria-pressed={item.take === false}
                disabled={item.streaming}
                aria-label={labels.proposalKeepSentence}
                onClick={() =>
                  onDecide(
                    item.callId,
                    item.index,
                    item.take === false ? null : false,
                  )
                }
              >
                {CROSS}
              </button>
            </Tooltip>
          </span>
        </div>
        {closed ? (
          <ChangeGlimpse
            before={item.before}
            after={item.after}
            shows={item.shows}
          />
        ) : original ? (
          // Result only: the text reads as it will; the card keeps what
          // the change takes out of it.
          <div className="revision-note-text revision-note-original">
            <s>
              <RevisionNoteText text={plainLine(item.before)} />
            </s>
            {/* What it becomes is in the text; read out here too, so the
              card says what is replaced by what. */}
            {item.after.trim() && (
              <span className="visually-hidden">
                {" "}
                <ins>
                  <RevisionNoteText text={revisionText(item.after, labels)} />
                </ins>
              </span>
            )}
          </div>
        ) : (
          <div className="revision-note-text">
            {/* The text shows the original; read out here too, so the
              card says what is replaced by what. */}
            {item.before.trim() && (
              <span className="visually-hidden">
                {labels.proposalDeletedSentence}:{" "}
                <del>
                  <RevisionNoteText text={item.before.trim()} />
                </del>
              </span>
            )}
            {item.after.trim() ? (
              <RevisionNoteText text={revisionText(item.after, labels)} />
            ) : (
              <span className="revision-note-delete">
                {labels.proposalDeleteSentence}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
  // Items are remade and their positions move as text is typed: only what
  // the card shows counts.
  (a, b) =>
    a.hot === b.hot &&
    a.focused === b.focused &&
    a.open === b.open &&
    a.onOpen === b.onOpen &&
    a.cut === b.cut &&
    a.chip === b.chip &&
    a.labels === b.labels &&
    a.top === b.top &&
    a.left === b.left &&
    a.onHot === b.onHot &&
    a.onDecide === b.onDecide &&
    a.onHeight === b.onHeight &&
    a.item.key === b.item.key &&
    a.item.callId === b.item.callId &&
    a.item.index === b.item.index &&
    a.item.num === b.item.num &&
    a.item.after === b.item.after &&
    a.item.before === b.item.before &&
    a.item.shows === b.item.shows &&
    a.item.take === b.item.take &&
    a.item.streaming === b.item.streaming,
);

export const NoteCard = memo(function NoteCard({
  itemKey,
  note,
  hot,
  picked,
  onPick,
  open,
  onOpen,
  cut,
  chip,
  labels,
  top,
  left,
  onHot,
  onDone,
  onAsk,
  onEdit,
  onHeight,
}: CardPlace & {
  itemKey: string;
  note: ReviewNote;
  /** Picked on the notes bar, or null while not picking. */
  picked: boolean | null;
  onPick: (id: string) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
}) {
  const ref = useCardBox(itemKey, top, onHeight, cut !== null);
  return (
    <div
      ref={ref}
      className={`review-note${hot ? " review-note-hot" : ""}${cutClass(cut, chip, open)}`}
      style={cardStyle(top, left, cut, open)}
      data-note={note.id}
      onMouseEnter={() => onHot(itemKey, true)}
      onMouseLeave={() => onHot(itemKey, false)}
      // Picking, the whole card picks it; else a click selects it, its own
      // buttons aside.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (picked !== null) onPick(note.id);
        else onOpen(itemKey);
      }}
    >
      {picked !== null && (
        <input
          type="checkbox"
          className="review-note-pick"
          checked={picked}
          aria-label={labels.reviewNotesPickOne}
          onChange={() => onPick(note.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {chip && !open ? (
        <>
          <div className="review-note-by">
            <NoteMark note={note} labels={labels} />
            {note.by === "me" ? labels.ownNoteBy : labels.reviewNoteBy}
          </div>
          <div className="review-note-chip-text">
            <InlineMarkdownText text={note.comment} />
          </div>
        </>
      ) : (
        <NoteBody
          note={note}
          labels={labels}
          onAsk={onAsk}
          onEdit={onEdit}
          onDone={onDone}
        />
      )}
    </div>
  );
});

/** Who wrote a note: Me for the writer's own, else the AI note's number. */
function NoteMark({
  note,
  labels,
}: {
  note: ReviewNote;
  labels: ReviewMarginLabels;
}) {
  return note.by === "me" ? (
    <span className="review-note-mark review-note-mark-me" aria-hidden="true">
      {labels.ownNoteMark}
    </span>
  ) : (
    <span className="review-note-num" aria-hidden="true">
      {note.num}
    </span>
  );
}

/** A note's card: who wrote it, the note, and its actions, in the margin
 *  and in the popover its badge opens. */
function NoteBody({
  note,
  labels,
  onAsk,
  onEdit,
  onDone,
}: {
  note: ReviewNote;
  labels: ReviewMarginLabels;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onDone: (id: string) => void;
}) {
  return (
    <>
      <div className="review-note-by">
        <NoteMark note={note} labels={labels} />
        {note.by === "me" ? labels.ownNoteBy : labels.reviewNoteBy}
      </div>
      <div className="review-note-text">
        <InlineMarkdownText text={note.comment} />
      </div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        {note.by === "me" && (
          <button type="button" onClick={() => onEdit(note)}>
            {labels.ownNoteEdit}
          </button>
        )}
        <button type="button" onClick={() => onDone(note.id)}>
          {note.by === "me" ? labels.ownNoteDelete : labels.reviewNoteDone}
        </button>
      </div>
    </>
  );
}

/** A change on its chip: a small one as what goes and what comes with a
 *  little context; a rewrite as the side the card shows. */
function ChangeGlimpse({
  before,
  after,
  shows,
}: {
  before: string;
  after: string;
  shows: RevisionItem["shows"];
}) {
  const g = changeGlimpse(plainLine(before), plainLine(after));
  if (!g.partial)
    return (
      <div className="review-note-chip-text">
        {shows === "new" && before.trim() ? (
          <s>{plainLine(before)}</s>
        ) : (
          plainLine(after)
        )}
      </div>
    );
  return (
    <div className="review-note-chip-text">
      {g.cutLead && "…"}
      {g.lead}
      {g.removed && <del>{g.removed}</del>}
      {g.added && <ins>{g.added}</ins>}
      {g.tail}
      {g.cutTail && "…"}
    </div>
  );
}

/** Compact mode: a note opened from its badge, as a small floating card
 *  under it. */
export function NotePopover({
  note,
  x,
  y,
  labels,
  onDone,
  onAsk,
  onEdit,
  onClose,
}: {
  note: ReviewNote;
  x: number;
  y: number;
  labels: ReviewMarginLabels;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept within the document's column, off the AI panel.
  const pos = useViewportClamp(ref, x, y, {
    right: () =>
      document
        .querySelector('[data-active-tab="true"] > .editor-scroll')
        ?.getBoundingClientRect().right,
  });
  useLayoutEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest?.(".review-badge"))
        return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="review-note review-note-popover floating-surface"
      style={pos}
      role="dialog"
      aria-label={labels.reviewNoteBy}
    >
      <NoteBody
        note={note}
        labels={labels}
        onAsk={onAsk}
        onEdit={onEdit}
        onDone={onDone}
      />
    </div>,
    document.body,
  );
}
