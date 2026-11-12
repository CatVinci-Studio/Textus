import type { ReactNode } from "react";
import { useKeptLoaded } from "../../utils/kept-loaded";
import { useEditorHeld } from "../../editor/tab-editor";

/** A plugin's page, or a source view, in a tab out of sight is let go after
 *  a while (three of a kind at most kept); shown again, it loads afresh, a
 *  page's saved state restored. */
export function KeptWhileHidden({
  shown,
  kind = "plugin-view",
  children,
}: {
  shown: boolean;
  kind?: string;
  children: ReactNode;
}) {
  return useKeptLoaded(kind, shown) ? children : null;
}

/** A document's editor is mounted only while its tab is in front of an
 *  island, as VS Code keeps one editor per group: shown again, it opens at
 *  its text with its undo history, caret and reading place. Kept out of
 *  sight only while Textus AI works in it (useHeldWhileBusy); let go as
 *  soon as that ends. */
export function EditorKept({
  tabId,
  shown,
  children,
}: {
  tabId: string;
  shown: boolean;
  children: ReactNode;
}) {
  const held = useEditorHeld(tabId);
  return shown || held ? children : null;
}
