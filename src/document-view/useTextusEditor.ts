import { type Dispatch, type SetStateAction, useRef } from "react";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { useEditor } from "@milkdown/react";
import {
  withEditorExtensions,
  type PendingEditCallbacks,
} from "./editor-extensions";
import type { DocumentReporting } from "./useDocumentReporting";
import { effectiveRevisionDisplay } from "../ai/revision/revision-display";
import type { ReviewNote } from "../ai/margin/review-notes-plugin";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import { configureEditorRoot } from "../editor/editor-extensions";

/** The ref-indirected callbacks the plugin chain reads at call time: the
 *  chain is built once, on mount, before the hooks that own the real
 *  functions exist. The component keeps each `.current` fresh. */
export interface EditorBridges {
  pendingEditActionsRef: { current: PendingEditCallbacks };
  onSelectionChangeRef: { current: () => void };
  noMarginRef: { current: boolean };
  reviewNotesRef: {
    current: {
      onChange: (notes: ReviewNote[]) => void;
      onBadge: (id: string, el: HTMLElement) => void;
    };
  };
}

/** Builds this tab's Milkdown instance: the full plugin chain
 *  (editor-extensions.ts) with the listener that reports the document. */
export function useTextusEditor({
  initialValue,
  reporting,
  settingsRef,
  filePathRef,
  tourRef,
  tRef,
  setQuickAskEl,
  requestImageName,
}: {
  initialValue: string;
  reporting: DocumentReporting;
  // The editor plugin chain below is only built once (empty deps), so
  // plugins read these refs to see live values instead of the ones
  // captured at construction time.
  settingsRef: { readonly current: Settings };
  filePathRef: { readonly current: string | null };
  tourRef: { readonly current: TourAi | null };
  tRef: { readonly current: Strings };
  setQuickAskEl: Dispatch<SetStateAction<HTMLElement | null>>;
  requestImageName: (stem: string, extension: string) => Promise<string | null>;
}): EditorBridges {
  const { reportedDocRef, onMounted, reportDoc } = reporting;
  // The pending-edit plugin's callbacks need to exist at chain-construction
  // time below, but the real accept/reject/sync functions come from
  // usePendingEdits, which needs `run` - only available after useEditor sets
  // up the Milkdown instance. This ref bridges the gap the same way
  // settingsRef/filePathRef do: a stable object the plugin reads `.current`
  // off of at call time (user interaction, well after mount), kept fresh by
  // an effect in useEditorProposals.
  const pendingEditActionsRef = useRef<PendingEditCallbacks>({
    onAccept: () => {},
    onReject: () => {},
    onPreviewsChange: () => {},
    getFocusedCallId: () => null,
    onDecide: () => {},
    getFocusedSentence: () => null,
  });
  // Same bridge, for the selection listener registered in the chain below:
  // the real handler needs `run` and the detached-chat bridge, neither of
  // which exists yet at construction time.
  const onSelectionChangeRef = useRef<() => void>(() => {});
  // Whether a rewrite's replacements are drawn in the text (no margin) -
  // ReviewMargin decides, the pending-edit plugin reads it.
  const noMarginRef = useRef(false);
  // The review notes' plugin callbacks, bridged like the pending edits'.
  const reviewNotesRef = useRef<{
    onChange: (notes: ReviewNote[]) => void;
    onBadge: (id: string, el: HTMLElement) => void;
  }>({ onChange: () => {}, onBadge: () => {} });

  useEditor(
    (root) =>
      withEditorExtensions(
        Editor.make().config((ctx) => {
          configureEditorRoot(ctx, root, initialValue);
          ctx
            .get(listenerCtx)
            .mounted((ctx) => {
              onMounted(ctx, ctx.get(editorViewCtx).state.doc);
            })
            // The listener's debounced report of an edit. Not
            // markdownUpdated: that serializes the whole document, and a
            // save writes only the changed blocks (useDocumentReporting).
            .updated((ctx, doc) => {
              reportedDocRef.current = doc;
              reportDoc(ctx, doc);
            })
            // Every new selection has to reach the detached chat window as a
            // fresh selection chip - that surface is defined by following
            // the user's work rather than a snapshot. Read through a ref
            // because this chain is built once, on mount.
            .selectionUpdated(() => onSelectionChangeRef.current());
        }),
        settingsRef,
        filePathRef,
        {
          onAccept: (callId) => pendingEditActionsRef.current.onAccept(callId),
          onReject: (callId) => pendingEditActionsRef.current.onReject(callId),
          onPreviewsChange: (previews, applied) =>
            pendingEditActionsRef.current.onPreviewsChange(previews, applied),
          getFocusedCallId: () =>
            pendingEditActionsRef.current.getFocusedCallId(),
          onDecide: (callId, index, take) =>
            pendingEditActionsRef.current.onDecide(callId, index, take),
          getFocusedSentence: () =>
            pendingEditActionsRef.current.getFocusedSentence(),
          revisionDisplay: () =>
            effectiveRevisionDisplay(
              settingsRef.current.revisionDisplay,
              !noMarginRef.current,
            ),
        },
        // setQuickAskEl is a useState setter - always stable, no ref
        // indirection needed (unlike pendingEdits above, whose real
        // callbacks don't exist yet at chain-construction time). The
        // unmount only clears if the element going away is still the
        // current one; see the plugin's onUnmount for why that matters.
        {
          onMount: setQuickAskEl,
          onUnmount: (el) =>
            setQuickAskEl((current) => (current === el ? null : current)),
        },
        tourRef,
        () => tRef.current.imagePasteFailedMessage,
        requestImageName,
        {
          onChange: (notes) => reviewNotesRef.current.onChange(notes),
          onBadge: (id, el) => reviewNotesRef.current.onBadge(id, el),
        },
      ),
    [],
  );

  return {
    pendingEditActionsRef,
    onSelectionChangeRef,
    noMarginRef,
    reviewNotesRef,
  };
}
