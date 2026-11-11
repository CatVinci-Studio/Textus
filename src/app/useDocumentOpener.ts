import { useEffect } from "react";
import { fill } from "../i18n/fill";
import { useFilesFromChat } from "../ai/chat/window/files-to-editor";
import { unlistenAll } from "../platform/events";
import {
  CHAT_TO_EDITOR,
  onWindowEvent,
  type OpenDocumentMessage,
} from "../ai/chat/window/chat-bridge";
import { exportDoc } from "../platform/ipc";
import { showConfirm } from "../engine/controls/app-dialog";
import { loadPlugins } from "../plugins/manager";
import { customEditorFor } from "../plugins/store/plugin-lookup";
import { isWordDocument } from "../document/word-import";
import { basename } from "../utils/path";
import { openDocument, setDocumentOpener } from "../utils/open-document";
import type { OpenOptions } from "./useFileOpening";
import type { Strings } from "../i18n/strings";

/**
 * This window opens what is asked of open-document: a file in a tab of its
 * own, a linked file of any type as offered below. What its detached chat
 * asks comes the same way.
 */
export function useDocumentOpener(
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>,
  t: Strings,
): void {
  useEffect(() => {
    // A linked file: in a tab when Textus shows it, or when an official
    // plugin would and the user installs it; else, once the user agrees, in
    // the system's app (a document's link shouldn't open things unseen; a
    // program is only shown in its folder, which the backend decides).
    const openLinkedFile = async (path: string) => {
      await loadPlugins().catch(() => {});
      if (isWordDocument(path) || customEditorFor(path)) {
        await openPathInTab(path);
        return;
      }
      const { offerPluginToOpen } = await import("../plugins/store/open-offer");
      const offered = await offerPluginToOpen(path, t);
      if (offered === "on") await openPathInTab(path);
      // The card's "Open with system app" was the user's say-so.
      if (offered === "system") await exportDoc.openLinkedFile(path);
      if (offered !== "none") return;
      const open = await showConfirm(
        fill(t.linkOpenFileConfirm, { name: basename(path) }),
        { okLabel: t.linkOpenFileOk, cancelLabel: t.cancel },
      );
      if (open) await exportDoc.openLinkedFile(path);
    };
    return setDocumentOpener(
      (path, { linked, ...open }) =>
        void (linked ? openLinkedFile(path) : openPathInTab(path, open)),
    );
  }, [openPathInTab, t]);
  useFilesFromChat();
  // What the detached chat asked to open, as it asked.
  useEffect(
    () =>
      unlistenAll(
        onWindowEvent<OpenDocumentMessage>(
          CHAT_TO_EDITOR.openDocument,
          ({ path, ...request }) => openDocument(path, request),
        ),
      ),
    [],
  );
}
