import { useEffect, type RefObject } from "react";
import { unlistenAll } from "../../../platform/events";
import { OPEN_FILE_IN_TAB_EVENT } from "../../../utils/events";
import { useWindowEvent } from "../../../utils/hooks/useWindowEvent";
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
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) =>
    send(CHAT_TO_EDITOR.openDocument, {
      path: (e as CustomEvent<string>).detail,
    }),
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
