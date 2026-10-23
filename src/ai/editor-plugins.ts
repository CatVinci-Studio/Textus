import type { Editor } from "@milkdown/kit/core";
import { createGhostTextPlugin } from "./writing/ghost-text-plugin";
import { buildCompletionStyle } from "./writing/completion-style";
import { createGrammarCheckPlugin } from "./writing/grammar-check-plugin";
import {
  createPendingEditPlugin,
  type PendingPreview,
} from "./revision/pending-edit-plugin";
import { chatSelectionPlugin } from "./chat/quick-ask/chat-selection-plugin";
import { blockReader } from "./revision/block-reader";
import { streamFollowPlugin } from "./revision/stream-follow-plugin";
import { createQuickAskWidgetPlugin } from "./chat/quick-ask/quick-ask-widget-plugin";
import {
  createReviewNotesPlugin,
  type ReviewNote,
} from "./margin/review-notes-plugin";
import { ownRevisionPlugin } from "./margin/own-revision-plugin";
import { resolveStrings } from "../i18n/strings";
import { sendTourSignal, type TourAi } from "../utils/events";
import type { RevisionDisplay, Settings } from "../settings/SettingsContext";
import { aiFeatures } from "../settings/textus-ai";

export interface PendingEditCallbacks {
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onPreviewsChange: (previews: PendingPreview[], applied: string[]) => void;
  /** Live read of the Quick Ask nav bar's current pointer - see
   *  createPendingEditPlugin's option of the same name. */
  getFocusedCallId: () => string | null;
  /** A ✓ / ✕ clicked in the text - see createPendingEditPlugin. */
  onDecide: (callId: string, index: number, take: boolean | null) => void;
  /** The sentence the review bar points at. */
  getFocusedSentence: () => { callId: string; index: number } | null;
  /** How a rewrite is drawn (revision-display.ts). */
  revisionDisplay?: () => RevisionDisplay;
}

/**
 * The AI features that live in the text: completion, grammar marks, a
 * rewrite's sentences, the Quick Ask selection and widget, review notes.
 * Each is independently switched in Settings, all of them under Textus
 * AI's own switch (settings/textus-ai.ts). They go on after the editor
 * core (editor/editor-extensions.ts), as the last plugins in the chain.
 *
 * The callbacks are stable, ref-indirected wrappers (see MilkdownEditor):
 * the chain is built once at mount, before the real handlers exist.
 */
export function withAiPlugins(
  editor: Editor,
  options: {
    settings: { readonly current: Settings };
    docPath: { readonly current: string | null };
    pendingEdits: PendingEditCallbacks;
    /** Hands the Quick Ask widget's DOM container over as it mounts. */
    quickAskWidget: {
      onMount: (el: HTMLElement) => void;
      onUnmount: (el: HTMLElement) => void;
    };
    /** The tour's AI while this is its practice tab (utils/events.ts's
     *  TourAi), else null: muted, the typing-triggered plugins go quiet. */
    tour: { readonly current: TourAi | null };
    reviewNotes: {
      onChange: (notes: ReviewNote[]) => void;
      onBadge: (id: string, el: HTMLElement) => void;
    };
  },
): Editor {
  const { settings, docPath, pendingEdits, quickAskWidget, tour, reviewNotes } =
    options;
  return (
    editor
      .use(blockReader)
      .use(
        createGhostTextPlugin({
          enabled: () =>
            aiFeatures(settings.current).completion && tour.current !== "muted",
          provider: () => settings.current.aiProvider,
          model: () =>
            settings.current.writingModels[settings.current.aiProvider] || null,
          style: () => buildCompletionStyle(settings.current.completionTone),
          uiLanguage: () => settings.current.language,
          project: () => ({
            docPath: docPath.current,
            workspaceRoot: settings.current.agentWorkspaceRoot || null,
          }),
          onAccept: () => {
            if (tour.current) sendTourSignal("completion-accepted");
          },
        }),
      )
      .use(
        createGrammarCheckPlugin({
          enabled: () =>
            aiFeatures(settings.current).grammar && tour.current !== "muted",
          provider: () => settings.current.aiProvider,
          model: () =>
            settings.current.writingModels[settings.current.aiProvider] || null,
          strictness: () => settings.current.grammarStrictness,
          uiLanguage: () => settings.current.language,
          project: () => ({
            docPath: docPath.current,
            workspaceRoot: settings.current.agentWorkspaceRoot || null,
          }),
        }),
      )
      .use(
        createPendingEditPlugin({
          ...pendingEdits,
          animationEnabled: () => settings.current.enableEditAnimation,
          sentenceLabels: () => {
            const t = resolveStrings(settings.current.language);
            return {
              take: t.proposalTakeSentence,
              keep: t.proposalKeepSentence,
            };
          },
        }),
      )
      .use(streamFollowPlugin)
      .use(chatSelectionPlugin)
      .use(createQuickAskWidgetPlugin(quickAskWidget))
      .use(createReviewNotesPlugin(reviewNotes))
      // Not AI: the writer's own tracked changes, which share the margin.
      .use(ownRevisionPlugin)
  );
}
