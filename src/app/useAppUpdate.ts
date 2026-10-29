import { useEffect, useState } from "react";
import type { Update } from "../platform/app-info";
import { relaunchApp } from "../platform/app-info";
import { checkChannel, selfUpdateAllowed } from "../platform/distribution";
import { flushPendingWrites } from "../storage/pending-writes";
import { canAutoUpdate } from "../platform/capabilities";
import { updater, type UpdateChannel } from "../platform/ipc";
import { currentStrings } from "../i18n/current";
import { explainError } from "../utils/error-explain";

export type UpdateStatus = "idle" | "available" | "downloading" | "error";

/**
 * Checks for releases and drives the update banner. Checking fails silently
 * (offline is normal); installing surfaces errors. Package-manager builds
 * only point the user at their package manager.
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
          // Offline or rate-limited is normal: stay silent.
        });
    };

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
      // On Windows downloadAndInstall exits the process without Rust's
      // exit-time flush, so held-back writes go now.
      await flushPendingWrites();
      await update.downloadAndInstall();
      // macOS and Linux: anything changed during the download.
      await flushPendingWrites();
      await updater.releaseInstance();
      await relaunchApp();
    } catch (err) {
      setError(explainError(err, currentStrings()));
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
