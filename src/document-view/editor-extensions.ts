import type { Editor } from "@milkdown/kit/core";
import { withEditorCore } from "../editor/editor-extensions";
import { withAiPlugins, type PendingEditCallbacks } from "../ai/editor-plugins";
import { pluginCodeBlocks } from "./plugin-code-blocks";
import type { ReviewNote } from "../ai/margin/review-notes-plugin";
import type { Settings } from "../settings/SettingsContext";
import type { TourAi } from "../utils/events";

export type { PendingEditCallbacks };

/**
 * The complete feature set the editor is composed of, in load order.
 * `settings` is a live ref (see useLatest) because the chain is built once
 * at mount while several features (AI, math, mermaid, typewriter,
 * placeholder language) follow the current Settings values. `pendingEdits`
 * is similarly built once - its callbacks must be stable, ref-indirected
 * wrappers (see MilkdownEditor) since usePendingEdits itself is created
 * from a `run` that isn't ready yet at this point.
 */
export function withEditorExtensions(
  editor: Editor,
  settings: { readonly current: Settings },
  docPath: { readonly current: string | null },
  pendingEdits: PendingEditCallbacks,
  /** Hands the Quick Ask widget's DOM container to MilkdownEditor as it
   *  mounts/unmounts - ref-indirected the same way `pendingEdits` is (this
   *  is built before the real callback exists). */
  quickAskWidget: {
    onMount: (el: HTMLElement) => void;
    onUnmount: (el: HTMLElement) => void;
  },
  /** The tour's AI while this is its practice tab, else null - see
   *  withAiPlugins. */
  tour: { readonly current: TourAi | null },
  /** A pasted image failed to save to disk - the message to show in a
   *  native alert (localized, since this plugin has no i18n access itself). */
  onImagePasteError: () => string,
  requestImageName: (stem: string, extension: string) => Promise<string | null>,
  /** The review notes' callbacks (review-notes-plugin.ts) - ref-indirected
   *  like `pendingEdits`. */
  reviewNotes: {
    onChange: (notes: ReviewNote[]) => void;
    onBadge: (id: string, el: HTMLElement) => void;
  } = { onChange: () => {}, onBadge: () => {} },
): Editor {
  return withAiPlugins(
    withEditorCore(editor, {
      settings,
      docPath,
      onImagePasteError,
      requestImageName,
    }),
    { settings, docPath, pendingEdits, quickAskWidget, tour, reviewNotes },
  ).use(pluginCodeBlocks(docPath));
}
