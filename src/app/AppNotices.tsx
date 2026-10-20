import { useEffect } from "react";
import { isIOSApp } from "../platform/capabilities";
import { announce } from "../ui/announce";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { basename } from "../utils/path";
import type { Strings } from "../i18n/strings";
import type { useAppUpdate } from "./useAppUpdate";

/** Zen mode's way out, shown while it is on (useZenMode.ts). */
export function ZenHint({ onExit, t }: { onExit: () => void; t: Strings }) {
  return isIOSApp ? (
    // No Esc key on a phone, and zen hides the menu: the hint is
    // the way out, so it stays (faintly) and takes a tap.
    <button type="button" className="zen-hint zen-hint-button" onClick={onExit}>
      {t.zenExitButton}
    </button>
  ) : (
    <div className="zen-hint" role="status">
      {t.zenExitHint}
    </div>
  );
}

/** Says that drafts from an earlier session were brought back
 *  (useStartupRestore). */
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
    <Presence show={count > 0} exitMs={120}>
      {count > 0 && (
        <PresenceDiv className="draft-restored-toast">
          <span>{t.draftRestoredMessage}</span>
          <button className="update-toast-secondary" onClick={onDismiss}>
            {t.draftRestoredDismiss}
          </button>
        </PresenceDiv>
      )}
    </Presence>
  );
}

/** How long the Word notice stays unless dismissed: it reports, it asks
 *  nothing. */
const WORD_NOTICE_MS = 12_000;

/** Says that the Word document at `path` was opened as a new Markdown one
 *  and may look different (document/word-import.ts). */
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
    <Presence show={path !== null} exitMs={120}>
      {path !== null && (
        <PresenceDiv className="draft-restored-toast">
          <span>{notice}</span>
          <button className="update-toast-secondary" onClick={onDismiss}>
            {t.wordImportDismiss}
          </button>
        </PresenceDiv>
      )}
    </Presence>
  );
}

/** The update banner (useAppUpdate.ts): available, downloading, failed. */
export function UpdateToast({
  appUpdate,
  t,
}: {
  appUpdate: ReturnType<typeof useAppUpdate>;
  t: Strings;
}) {
  return (
    <Presence show={appUpdate.status !== "idle"} exitMs={120}>
      {appUpdate.status !== "idle" && (
        <PresenceDiv className="update-toast">
          {appUpdate.status === "available" && (
            <>
              <span>
                {t.updateAvailable} v{appUpdate.version}
              </span>
              {appUpdate.selfUpdate ? (
                <button
                  className="update-toast-primary"
                  onClick={() => void appUpdate.install()}
                >
                  {t.updateInstall}
                </button>
              ) : (
                <span>{t.updateViaPackageManager}</span>
              )}
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
          {appUpdate.status === "downloading" && (
            <span>{t.updateDownloading}</span>
          )}
          {appUpdate.status === "error" && (
            <>
              <span>
                {t.updateFailed} {appUpdate.error}
              </span>
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
        </PresenceDiv>
      )}
    </Presence>
  );
}
