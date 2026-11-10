import { useCallback, useEffect, useState } from "react";
import { IconButton } from "../engine/controls/IconButton";
import { CloseIcon } from "../engine/controls/icons";
import { announce } from "../engine/controls/announce";
import { CornerToast } from "../engine/controls/CornerToast";
import { basename } from "../utils/path";
import type { Strings } from "../i18n/strings";
import type { useAppUpdate } from "./useAppUpdate";

/** Zen mode's way out while it is on: a quiet × at the top right (Esc
 *  doesn't leave it - Esc closes what is open in the text). */
export function ZenExit({ onExit, t }: { onExit: () => void; t: Strings }) {
  return (
    <IconButton label={t.zenExitButton} onClick={onExit} className="zen-exit">
      <CloseIcon />
    </IconButton>
  );
}

/** Says that drafts from an earlier session were brought back. */
export function DraftRestoredToast({
  count,
  onDismiss,
  t,
}: {
  count: number;
  onDismiss: () => void;
  t: Strings;
}) {
  return (
    <CornerToast
      show={count > 0}
      name="draft-restored-toast"
      line={t.draftRestoredMessage}
      actions={[{ label: t.draftRestoredDismiss, onSelect: onDismiss }]}
    />
  );
}

/** The Word document last opened as a new one, for its notice. */
export function useWordImported() {
  const [path, setPath] = useState<string | null>(null);
  const dismiss = useCallback(() => setPath(null), []);
  return { path, opened: setPath, dismiss };
}

/** How long the Word notice stays unless dismissed: it reports, it asks
 *  nothing. */
const WORD_NOTICE_MS = 12_000;

/** Says the Word document at `path` was opened as a new Markdown one and
 *  may look different. */
export function WordImportNotice({
  path,
  onDismiss,
  t,
}: {
  path: string | null;
  onDismiss: () => void;
  t: Strings;
}) {
  const notice = path && t.wordImportNotice.replace("{name}", basename(path));
  useEffect(() => {
    if (notice) announce(notice);
  }, [notice]);
  useEffect(() => {
    if (!path) return;
    const timer = window.setTimeout(onDismiss, WORD_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [path, onDismiss]);
  return (
    <CornerToast
      show={path !== null}
      name="word-import-toast"
      line={notice}
      actions={[{ label: t.wordImportDismiss, onSelect: onDismiss }]}
    />
  );
}

/** The update banner: available, downloading, failed. */
export function UpdateToast({
  appUpdate,
  t,
}: {
  appUpdate: ReturnType<typeof useAppUpdate>;
  t: Strings;
}) {
  const later = { label: t.updateLater, onSelect: appUpdate.dismiss };
  const state = {
    idle: null,
    available: {
      line: `${t.updateAvailable} v${appUpdate.version}${
        appUpdate.selfUpdate ? "" : ` · ${t.updateViaPackageManager}`
      }`,
      actions: appUpdate.selfUpdate
        ? [
            {
              label: t.updateInstall,
              onSelect: () => void appUpdate.install(),
              primary: true,
            },
            later,
          ]
        : [later],
    },
    downloading: { line: t.updateDownloading, actions: [] },
    error: { line: `${t.updateFailed} ${appUpdate.error}`, actions: [later] },
  }[appUpdate.status];
  return (
    <CornerToast
      show={state !== null}
      name="update-toast"
      line={state?.line ?? ""}
      actions={state?.actions ?? []}
    />
  );
}
