import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "../../editor/useEditorRunner";
import {
  numberNotes,
  reviewNotesKey,
  type ReviewNote,
} from "./review-notes-plugin";
import { commentCalls } from "../chat/comment-args";
import type { AgentConversation } from "../chat/conversation/conversation-types";
import { type usePendingEdits } from "../revision/usePendingEdits";
import { locateTarget } from "../revision/pending-place";
import { pendingEditKey, type HotSentence } from "../revision/pending-types";
import type { RevisionDisplay } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { useOpenedCard } from "./margin-layout";
import { useOwnNotes } from "./useOwnNotes";
import { useOwnRevisions } from "./useOwnRevisions";
import { OWN_CHANGES, ownRevisionKey } from "./own-revision-plugin";
import { asDrawn, zoomedRectScale } from "../../engine/zoom/zoomed-rects";
import { marginItemsOf } from "./margin-items";
import { useLatest } from "../../utils/hooks/useLatest";

/** A note's badge clicked open, where its card shows. */
type OpenNote = { id: string; x: number; y: number };

/** The plugin's ref-indirected callbacks. */
type ReviewNotesCallbacks = {
  current: {
    onChange: (notes: ReviewNote[]) => void;
    onBadge: (id: string, el: HTMLElement) => void;
  };
};

/** The notes in the margin, as the plugin last reported them; the ref
 *  for what reads them later. */
export function useNotes() {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const notesRef = useLatest(notes);
  return { notes, setNotes, notesRef };
}

/** What the pointer is on - a margin card or its passage ("note:<id>",
 *  "rev:<callId>:<index>"): both light up together. Kept in a ref too, at
 *  once: two pointer events can land before a render. */
export function useHotItem() {
  const [hotNote, setHotNote] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);
  const setNoteHot = useCallback((key: string | null) => {
    hotRef.current = key;
    setHotNote(key);
  }, []);
  return { hotNote, hotRef, setNoteHot };
}

/** The plugin's notes and badges reported here: the notes as they change,
 *  a badge clicked open as the card it stands for. */
export function useNoteCallbacks(
  reviewNotesRef: ReviewNotesCallbacks,
  setNotes: Dispatch<SetStateAction<ReviewNote[]>>,
) {
  const [openNote, setOpenNote] = useState<OpenNote | null>(null);
  useEffect(() => {
    reviewNotesRef.current = {
      onChange: setNotes,
      onBadge: (id, el) => {
        // In the text, so inside the document's zoom.
        const r = asDrawn(el.getBoundingClientRect(), zoomedRectScale(el));
        setOpenNote({ id, x: r.left, y: r.bottom + 6 });
      },
    };
  }, [reviewNotesRef, setNotes]);
  return [openNote, setOpenNote] as const;
}

/** The notes the AI left in its conversations (the panel's and Quick
 *  Ask's, each still streaming in once its passage and text are whole),
 *  placed on their passages; a draft placed before its context came is
 *  placed again from the completed call when that differs. Notes marked
 *  done stay away. */
export function useConversationNotes(
  run: EditorRunner,
  conversation: AgentConversation,
  quickConversation: AgentConversation,
) {
  const doneNotes = useRef(new Set<string>());
  // Notes whose passage wasn't found, by what they were placed from.
  const lostNotes = useRef(new Set<string>());
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const panelTurns = conversation.streaming?.turns;
  const quickTurns = quickConversation.streaming?.turns;
  const panelDrafts = conversation.streaming?.comments;
  const quickDrafts = quickConversation.streaming?.comments;
  const comments = useMemo(
    () =>
      commentCalls([
        ...conversation.history,
        ...(panelTurns ?? []),
        ...(panelDrafts ?? []),
        ...quickConversation.history,
        ...(quickTurns ?? []),
        ...(quickDrafts ?? []),
      ]),
    [
      conversation.history,
      panelTurns,
      panelDrafts,
      quickConversation.history,
      quickTurns,
      quickDrafts,
    ],
  );
  const placedFrom = useRef(new Map<string, string>());
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      setEditorView(view);
      const current = reviewNotesKey.getState(view.state)?.notes ?? [];
      const wanted = comments.filter((c) => !doneNotes.current.has(c.id));
      const from = (c: (typeof wanted)[number]) =>
        [c.block ?? "", c.anchor, c.comment].join("\0");
      // The writer's own notes aren't the conversation's to drop.
      const keep = current.filter(
        (n) =>
          n.by === "me" ||
          wanted.some(
            (w) => w.id === n.id && placedFrom.current.get(n.id) === from(w),
          ),
      );
      const added: Omit<ReviewNote, "num">[] = [];
      for (const c of wanted) {
        if (keep.some((n) => n.id === c.id) || lostNotes.current.has(from(c)))
          continue;
        placedFrom.current.set(c.id, from(c));
        const range = locateTarget(ctx, view.state.doc, c);
        if (!range || range.from >= range.to) {
          lostNotes.current.add(from(c));
          continue;
        }
        added.push({ id: c.id, ...range, comment: c.comment });
      }
      if (added.length === 0 && keep.length === current.length) return;
      view.dispatch(
        view.state.tr.setMeta(reviewNotesKey, {
          type: "set",
          notes: numberNotes(keep, added).sort((a, b) => a.from - b.from),
        }),
      );
    });
  }, [comments, run]);
  return { editorView, doneNotes };
}

/** The writer's own notes and own tracked changes in this document. */
export function useOwnWork({
  isActive,
  run,
  filePath,
  notes,
  t,
}: {
  isActive: boolean;
  run: EditorRunner;
  filePath: string | null;
  notes: ReviewNote[];
  t: Strings;
}) {
  const own = useOwnNotes({ run, filePath, notes, t });
  const revisions = useOwnRevisions({ isActive, run, filePath, t });
  return { own, revisions };
}

/** The margin's items (the notes, then each pending sentence in the review
 *  bar's order) and the one selected: whichever came last of a click or a
 *  bar's pointer. Lit, card and passage both: what the pointer is on, else
 *  the selected one - it stays lit while it is read, not only while
 *  pointed at - through the plugins, never a class written onto the text. */
export function useLitItem({
  run,
  notes,
  pendingEdits,
  revisionDisplay,
  ownChanges,
  barFocus,
  hotNote,
}: {
  run: EditorRunner;
  notes: ReviewNote[];
  pendingEdits: ReturnType<typeof usePendingEdits>;
  revisionDisplay: RevisionDisplay;
  ownChanges: ReturnType<typeof useOwnRevisions>["changes"];
  barFocus: string | null;
  hotNote: string | null;
}) {
  const marginItems = useMemo(
    () =>
      marginItemsOf(
        notes,
        pendingEdits.reviewStops,
        pendingEdits.reviewed,
        revisionDisplay,
        ownChanges,
      ),
    [
      notes,
      pendingEdits.reviewStops,
      pendingEdits.reviewed,
      revisionDisplay,
      ownChanges,
    ],
  );
  const { focusedStop } = pendingEdits;
  const pointed =
    barFocus ??
    (focusedStop ? `rev:${focusedStop.callId}:${focusedStop.index}` : null);
  const [clicked, setClicked] = useOpenedCard<{
    key: string;
    over: string | null;
  }>();
  const focusedItem =
    clicked && clicked.over === pointed ? clicked.key : pointed;
  const lit = hotNote ?? focusedItem;
  useEffect(() => {
    const id = lit?.startsWith("note:") ? lit.slice(5) : null;
    let sentence: HotSentence | null = null;
    if (lit?.startsWith("rev:")) {
      const [, callId, index] = lit.split(":");
      sentence = { callId, index: Number(index) };
    }
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr
          .setMeta(reviewNotesKey, { type: "hot", id })
          .setMeta(pendingEditKey, { type: "hot", sentence })
          .setMeta(ownRevisionKey, {
            type: "hot",
            index: sentence?.callId === OWN_CHANGES ? sentence.index : null,
          }),
      );
    });
  }, [lit, run]);
  return { marginItems, focusedItem, lit, setClicked, pointed };
}
