import { useEffect, type RefObject } from "react";
import { unlistenAll } from "../../../platform/events";
import { setDocumentOpener } from "../../../utils/open-document";
import { filesChanged, relayFileChanges } from "../file-changes";
import { revisionsArrived } from "../../revision/file-revisions";
import {
  CHAT_TO_EDITOR,
  onWindowEvent,
  sendToWindow,
  type FilesChangedMessage,
} from "./chat-bridge";

/**
 * The detached chat's side: the editor shows the files, so what a reply
 * here changed, and a file asked for from a card, go to it.
 */
export function useFilesToEditor(editorLabel: RefObject<string | null>): void {
  const send = (event: string, payload: unknown) => {
    if (editorLabel.current) sendToWindow(editorLabel.current, event, payload);
  };
  useEffect(
    () =>
      relayFileChanges((written, revised) =>
        send(CHAT_TO_EDITOR.filesChanged, { written, revised }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorLabel],
  );
  // The files asked for here open in the editor's window, as asked.
  useEffect(
    () =>
      setDocumentOpener((path, request) =>
        send(CHAT_TO_EDITOR.openDocument, { path, ...request }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorLabel],
  );
}

/** The editor's side: files a reply in its detached chat changed are
 *  marked here, read again and their revisions placed. */
export function useFilesFromChat(): void {
  useEffect(
    () =>
      unlistenAll(
        onWindowEvent<FilesChangedMessage>(
          CHAT_TO_EDITOR.filesChanged,
          ({ written, revised }) => {
            if (written.length) filesChanged(written);
            for (const file of revised) void revisionsArrived(file);
          },
        ),
      ),
    [],
  );
}
