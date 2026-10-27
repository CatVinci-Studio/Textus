import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin } from "@milkdown/kit/prose/state";
import { DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { FoldAttention } from "../../editor/html/details-fold";
import { onPictureSettled } from "./generated-images";
import type { RevisionDisplay } from "../../settings/SettingsContext";
import type {
  AppliedEdit,
  HotSentence,
  PendingMeta,
  PendingPreview,
  PendingState,
} from "./pending-types";
import { pendingEditKey } from "./pending-types";
export { pendingEditKey } from "./pending-types";
import { dropAnimation, stillRevealing } from "./pending-animation";
import type { SentencePickLabels } from "./pending-widgets";
import {
  type SentenceHooks,
  buildDecorations,
  hotDecorations,
  hotSets,
  syncDisplay,
  syncStreaming,
  syncWidgetClasses,
} from "./pending-decorations";
import {
  MAX_APPLIED,
  mapPreviews,
  replayHistory,
  withStreamChanges,
} from "./pending-mapping";

export {
  type PendingSentence,
  type PendingPreview,
  sentenceTake,
  reviewChanges,
  type HotSentence,
} from "./pending-types";
export {
  streamPendingInsertText,
  stopRewrite,
  stoppedRewrite,
} from "./pending-animation";
export { type SentencePickLabels } from "./pending-widgets";
export { REVISION_DISPLAY_ATTR } from "./pending-decorations";

/** The call ids accepted and not undone - what the cards show as applied. */
export function appliedCallIds(state: EditorState): string[] {
  return (pendingEditKey.getState(state)?.applied ?? [])
    .filter((entry) => !entry.undone)
    .map((entry) => entry.preview.callId);
}

export function hasPendingEdits(state: EditorState): boolean {
  return (pendingEditKey.getState(state)?.previews.length ?? 0) > 0;
}

/** Shows proposals as decorations in the document; accepting happens
 *  outside it. A preview whose mapped text no longer matches is dropped
 *  rather than risk applying it to the wrong text. */
export function createPendingEditPlugin(options: {
  /** Accept/reject via ⌘Enter / ⌘Backspace, on `getFocusedCallId()`'s
   *  preview when still pending, else the first one. */
  onAccept?: (callId: string) => void;
  onReject?: (callId: string) => void;
  /** Fired whenever the live preview list changes: the plugin's only way to
   *  reach React. */
  onPreviewsChange?: (previews: PendingPreview[], applied: string[]) => void;
  /** Whether the green widget types its text in, read live. Off, or unset:
   *  the text appears at once. */
  animationEnabled?: () => boolean;
  /** Live read of the Quick Ask nav bar's current pointer. */
  getFocusedCallId?: () => string | null;
  /** A ✓ / ✕ in the text was clicked. */
  onDecide?: (callId: string, index: number, take: boolean | null) => void;
  /** The ✓ / ✕ buttons' names, read live (the UI language can change). */
  sentenceLabels?: () => SentencePickLabels;
  /** The sentence the review bar points at. */
  getFocusedSentence?: () => { callId: string; index: number } | null;
  /** How a rewrite is drawn, already fallen back where there's no margin;
   *  read live, applied on the next transaction. */
  revisionDisplay?: () => RevisionDisplay;
}) {
  const animate = () => options.animationEnabled?.() ?? false;
  const hooks: SentenceHooks = {
    labels: () =>
      options.sentenceLabels?.() ?? { take: "Accept", keep: "Keep original" },
    decide: (callId, index, take) => options.onDecide?.(callId, index, take),
    focused: () => options.getFocusedSentence?.() ?? null,
  };
  /** Whatever left the preview list takes its typewriter state with it. */
  const dropRemovedAnimations = (
    prev: PendingPreview[],
    next: PendingPreview[],
  ) => {
    for (const p of prev) {
      if (!next.some((n) => n.callId === p.callId)) dropAnimation(p.callId);
    }
  };
  const applyMeta = (
    tr: Transaction,
    prev: PendingState,
    meta: PendingMeta | undefined,
  ): Omit<PendingState, "applied" | "hot" | "landed"> => {
    if (meta?.type === "add") {
      const keep = prev.previews.filter(
        (p) => !meta.previews.some((n) => n.callId === p.callId),
      );
      // A final add while the typewriter still reveals keeps the streaming
      // state: only the settle meta makes the preview decidable.
      const previews = [
        ...keep,
        ...meta.previews.map((p) => {
          // Rebased around the writer's edit: drawn settled, as its stream's
          // reveal would hold it undecidable for good.
          if (p.rebased && !p.streaming) dropAnimation(p.callId);
          const revealing = stillRevealing(p.callId);
          // New text with no typewriter to grow it is drawn anew, or the
          // widget's key would keep the old one.
          const old = prev.previews.find((o) => o.callId === p.callId);
          const revision =
            old && !revealing && old.replacement !== p.replacement
              ? Math.max(p.revision ?? 0, (old.revision ?? 0) + 1)
              : (p.revision ?? old?.revision);
          const next = revision === undefined ? p : { ...p, revision };
          return p.streaming || revealing ? { ...next, streaming: true } : next;
        }),
      ];
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "settle") {
      if (!prev.previews.some((p) => p.callId === meta.callId && p.streaming))
        return prev;
      const previews = prev.previews.map((p) =>
        p.callId === meta.callId ? { ...p, streaming: undefined } : p,
      );
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "decide") {
      const previews = prev.previews.map((p) =>
        p.callId === meta.callId && p.sentences
          ? {
              ...p,
              sentences: {
                hunks: p.sentences.hunks,
                changes: p.sentences.changes.map((c, i) =>
                  i === meta.index ? { ...c, take: meta.take } : c,
                ),
              },
            }
          : p,
      );
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (
      meta?.type === "refocus" ||
      (meta?.type === "relayout" &&
        prev.previews.some((p) => p.callId === meta.callId))
    ) {
      return {
        previews: prev.previews,
        decoration: buildDecorations(tr.doc, prev.previews, animate(), hooks),
      };
    }
    if (meta?.type === "remove") {
      const rest = prev.previews.filter((p) => p.callId !== meta.callId);
      // An Accept applies and removes its preview in one transaction; the
      // others still have to be mapped through that edit.
      const previews = tr.docChanged ? mapPreviews(rest, tr).survivors : rest;
      dropRemovedAnimations(prev.previews, previews);
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "clear") {
      dropRemovedAnimations(prev.previews, []);
      return prev.previews.length === 0
        ? prev
        : { previews: [], decoration: DecorationSet.empty };
    }
    if (tr.docChanged && prev.previews.length > 0) {
      const { survivors, changed } = mapPreviews(prev.previews, tr);
      if (!changed) {
        // Typing elsewhere keeps the array's identity, so React isn't
        // re-notified on every keystroke.
        return {
          previews: prev.previews,
          decoration: prev.decoration.map(tr.mapping, tr.doc),
        };
      }
      dropRemovedAnimations(prev.previews, survivors);
      return {
        previews: survivors,
        decoration: buildDecorations(tr.doc, survivors, animate(), hooks),
      };
    }
    return prev;
  };
  return $prose(
    () =>
      new Plugin<PendingState>({
        key: pendingEditKey,
        // A proposal for text folded in a <details> opens it: an edit the
        // writer can't see can't be decided on.
        foldAttention: ((state) =>
          (pendingEditKey.getState(state)?.previews ?? []).map((p) => ({
            key: `edit:${p.callId}`,
            from: p.from,
            to: p.to,
          }))) satisfies FoldAttention,
        state: {
          init: (): PendingState => ({
            previews: [],
            decoration: DecorationSet.empty,
            applied: [],
            hot: null,
            landed: [],
          }),
          apply(tr, prev): PendingState {
            const meta = tr.getMeta(pendingEditKey) as PendingMeta | undefined;
            const replay = tr.docChanged ? replayHistory(tr, prev) : null;
            if (replay) {
              dropRemovedAnimations(prev.previews, replay.previews);
              return {
                previews: replay.previews,
                applied: replay.applied,
                hot: prev.hot,
                landed: [],
                decoration: buildDecorations(
                  tr.doc,
                  replay.previews,
                  false,
                  hooks,
                ),
              };
            }
            let applied = prev.applied;
            if (meta?.type === "remove" && meta.applied && tr.docChanged) {
              const taken = prev.previews.find((p) => p.callId === meta.callId);
              if (taken)
                applied = [
                  ...applied.filter((e) => e.preview.callId !== meta.callId),
                  {
                    preview: taken,
                    before: tr.before,
                    after: tr.doc,
                    undone: false,
                  },
                ].slice(-MAX_APPLIED);
            } else if (meta?.type === "clear") {
              applied = [];
            }
            const hot = meta?.type === "hot" ? meta.sentence : prev.hot;
            const landed =
              meta?.type === "remove" && meta.landed
                ? meta.landed
                : tr.docChanged && prev.landed.length > 0
                  ? []
                  : prev.landed;
            const next = applyMeta(tr, prev, meta);
            const previews = withStreamChanges(next.previews);
            return next === prev &&
              previews === prev.previews &&
              applied === prev.applied &&
              hot === prev.hot &&
              landed === prev.landed
              ? prev
              : { ...next, previews, applied, hot, landed };
          },
        },
        props: {
          decorations(state) {
            const pending = pendingEditKey.getState(state);
            if (!pending?.hot && !pending?.landed.length)
              return pending?.decoration;
            let set = hotSets.get(pending);
            if (!set) {
              set = hotDecorations(state.doc, pending);
              hotSets.set(pending, set);
            }
            return set;
          },
          // Before every plugin's handleKeyDown: on a preview these keys
          // decide it, ahead of the editor's own Mod+Enter and Mod+Backspace.
          handleDOMEvents: {
            keydown(view, event) {
              const mod = event.metaKey || event.ctrlKey;
              if (!mod) return false;
              const previews =
                pendingEditKey.getState(view.state)?.previews ?? [];
              if (previews.length === 0) return false;
              const focused = options.getFocusedCallId?.() ?? null;
              const targetId =
                (focused && previews.some((p) => p.callId === focused)
                  ? focused
                  : null) ?? previews[0].callId;
              // The sentence the review bar points at (‹ › or F7) is the
              // one decided, as its ✓ / ✕ would.
              const sentence = options.getFocusedSentence?.() ?? null;
              const pointed =
                sentence && sentence.index >= 0 && sentence.callId === targetId
                  ? sentence
                  : null;
              if (event.key === "Enter") {
                event.preventDefault();
                if (pointed)
                  options.onDecide?.(pointed.callId, pointed.index, true);
                else options.onAccept?.(targetId);
                return true;
              }
              if (event.key === "Backspace") {
                // Ctrl/Cmd+Backspace are everyday delete keys, so they reject
                // only with the caret on a preview itself.
                const { selection } = view.state;
                if (!selection.empty) return false;
                const here = previews.find(
                  (p) => selection.from >= p.from && selection.from <= p.to,
                );
                if (!here) return false;
                event.preventDefault();
                if (pointed && pointed.callId === here.callId)
                  options.onDecide?.(pointed.callId, pointed.index, false);
                else options.onReject?.(here.callId);
                return true;
              }
              return false;
            },
          },
        },
        view(editorView) {
          let last: PendingPreview[] = [];
          let lastApplied: AppliedEdit[] = [];
          let lastDecoration: DecorationSet | null = null;
          let lastHot: HotSentence | null = null;
          const display = () => options.revisionDisplay?.() ?? "inline";
          syncDisplay(editorView, display());
          // A redone picture that has come (or failed) is drawn anew: the
          // veil gives way to the old struck and the new beside it.
          const stopPictures = onPictureSettled(() => {
            const previews =
              pendingEditKey.getState(editorView.state)?.previews ?? [];
            if (previews.some((p) => p.proposal.image))
              editorView.dispatch(
                editorView.state.tr.setMeta(pendingEditKey, {
                  type: "refocus",
                }),
              );
          });
          return {
            destroy() {
              stopPictures();
            },
            update(view) {
              syncDisplay(view, display());
              const state = pendingEditKey.getState(view.state);
              const previews = state?.previews ?? [];
              // Also when only the previews changed: a streaming rewrite may
              // have nothing drawn yet, and an empty set is always the same.
              if (
                state &&
                (state.decoration !== lastDecoration || previews !== last)
              )
                syncStreaming(view, previews);
              // After any rebuild, not only when the pointer moves: a
              // redrawn widget comes back without the classes.
              if (
                state &&
                (state.hot !== lastHot || state.decoration !== lastDecoration)
              ) {
                lastHot = state.hot;
                lastDecoration = state.decoration;
                syncWidgetClasses(view, state.hot, hooks.focused());
              }
              const applied = state?.applied ?? [];
              if (previews !== last || applied !== lastApplied) {
                last = previews;
                lastApplied = applied;
                options.onPreviewsChange?.(
                  previews,
                  appliedCallIds(view.state),
                );
              }
            },
          };
        },
      }),
  );
}
