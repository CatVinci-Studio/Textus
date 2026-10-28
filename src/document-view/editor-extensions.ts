import type { Editor } from "@milkdown/kit/core";
import { withEditorCore } from "../editor/editor-extensions";
import { withAiPlugins, type PendingEditCallbacks } from "../ai/editor-plugins";
import { pluginCodeBlocks } from "./plugins/plugin-code-blocks";
import { pluginDecorations } from "./plugins/plugin-decorations";
import type { ReviewNote } from "../ai/margin/review-notes-plugin";
import type { Settings } from "../prefs/SettingsContext";
import type { TourAi } from "../utils/events";

export type { PendingEditCallbacks };

/**
 * The editor's full feature set, in load order. Built once at mount, so
 * `settings` is a live ref and `pendingEdits` callbacks are ref-indirected.
 */
export function withEditorExtensions(
  editor: Editor,
  settings: { readonly current: Settings },
  docPath: { readonly current: string | null },
  pendingEdits: PendingEditCallbacks,
  /** Hands the Quick Ask widget's container over as it mounts and
   *  unmounts; ref-indirected like `pendingEdits`. */
  quickAskWidget: {
    onMount: (el: HTMLElement) => void;
    onUnmount: (el: HTMLElement) => void;
  },
  /** The tour's AI while this is its practice tab, else null. */
  tour: { readonly current: TourAi | null },
  /** A pasted image failed to save: the localized message to show. */
  onImagePasteError: () => string,
  requestImageName: (stem: string, extension: string) => Promise<string | null>,
  /** The review notes' callbacks, ref-indirected like `pendingEdits`. */
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
  )
    .use(pluginCodeBlocks(docPath))
    .use(pluginDecorations);
}
