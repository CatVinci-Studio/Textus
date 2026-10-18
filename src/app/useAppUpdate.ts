import { errorText } from "../utils/error-text";
import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkChannel, selfUpdateAllowed } from "../platform/distribution";
import { flushPendingWrites } from "../storage/pending-writes";
import { canAutoUpdate } from "../platform/capabilities";
import { updater, type UpdateChannel } from "../platform/ipc";

export type UpdateStatus = "idle" | "available" | "downloading" | "error";

/**
 * Checks for a new release at startup, every 4 hours and whenever the
 * update channel changes, and drives the update banner: available -> user
 * confirms -> download + install -> relaunch. The stable channel reads the
 * latest GitHub release's textus-latest.json (never latest.json, which is
 * what Levis installs read; see scripts/updater-manifest.mjs), the beta
 * channel textus-beta.json on our download bucket
 * (src-tauri/src/commands/update.rs). Checking is silent on
 * failure - offline, rate-limited, or running in a plain browser during
 * development are all normal situations, not something to bother the user
 * about. Installing is the opposite: the user explicitly asked, so errors
 * surface.
 *
 * A package-manager build (see platform/distribution.ts) still checks, but
 * `selfUpdate` is false: the banner tells the user to upgrade through the
 * package manager, and install() does nothing.
 */
export function useAppUpdate(channel: UpdateChannel) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selfUpdate, setSelfUpdate] = useState(true);

  useEffect(() => {
    // iOS updates come from the App Store; the updater isn't built there.
    if (!canAutoUpdate) return;
    let cancelled = false;
    void selfUpdateAllowed().then((allowed) => {
      if (!cancelled) setSelfUpdate(allowed);
    });

    const checkOnce = () => {
      selfUpdateAllowed()
        .then((allowed) => updater.check(checkChannel(channel, allowed)))
        .then((found) => {
          if (!cancelled && found) {
            setUpdate(found);
            setStatus("available");
          }
        })
        .catch(() => {
          // Silent by design - see the hook comment.
        });
    };

    // Once at startup, then periodically so a window that stays open for
    // days still hears about new releases.
    checkOnce();
    const timer = setInterval(checkOnce, 4 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channel]);

  async function install() {
    if (!canAutoUpdate || !update || !(await selfUpdateAllowed())) return;
    setStatus("downloading");
    try {
      // Neither way out of here asks a window to close first. On Windows
      // downloadAndInstall never returns: it starts the installer and ends
      // the process (tauri-plugin-updater calls std::process::exit, which
      // also skips Rust's exit-time flush) - so what's held back goes now,
      // and Rust's own 250 ms write lands while the download runs.
      await flushPendingWrites();
      await update.downloadAndInstall();
      // macOS and Linux: anything changed during the download, then the
      // relaunch (which does flush Rust's files on its way out).
      await flushPendingWrites();
      await relaunch();
    } catch (err) {
      setError(errorText(err));
      setStatus("error");
    }
  }

  function dismiss() {
    setUpdate(null);
    setStatus("idle");
  }

  return {
    version: update?.version ?? null,
    status,
    error,
    selfUpdate,
    install,
    dismiss,
  };
}
