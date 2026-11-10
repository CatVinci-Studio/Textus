import type { ReactNode } from "react";
import { useKeptLoaded } from "../../utils/kept-loaded";
import { editorHeld } from "../../document/editor-held";

/** A plugin's page in a tab out of sight is let go after a while (three
 *  at most kept); shown again, it loads afresh, its saved state restored. */
export function KeptWhileHidden({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  return useKeptLoaded("plugin-view", shown) ? children : null;
}

/** A document's editor out of sight ten minutes is let go, unless Textus
 *  AI or undecided changes live in it, or it has no file to come back
 *  from; shown again, it opens at its text with its undo history. */
const EDITOR_HIDDEN_MS = 10 * 60_000;

export function EditorKept({
  tabId,
  shown,
  children,
}: {
  tabId: string;
  shown: boolean;
  children: ReactNode;
}) {
  const loaded = useKeptLoaded("editor", shown, {
    hiddenMs: EDITOR_HIDDEN_MS,
    max: Infinity,
    hold: () => editorHeld(tabId),
  });
  return loaded ? children : null;
}
