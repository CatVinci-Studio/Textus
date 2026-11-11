import { useEffect, useSyncExternalStore } from "react";
import type { Update } from "../platform/app-info";
import { relaunchApp } from "../platform/app-info";
import { checkChannel, selfUpdateAllowed } from "../platform/distribution";
import { flushPendingWrites } from "../storage/pending-writes";
import { canAutoUpdate } from "../platform/capabilities";
import { updater, type UpdateChannel } from "../platform/ipc";
import { currentStrings } from "../i18n/current";
import { explainError } from "../utils/error-explain";

type UpdateStatus = "idle" | "available" | "downloading" | "error";

interface AppUpdate {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  /** False for a package manager's build: it updates there, not here. */
  selfUpdate: boolean;
}

/**
 * A newer release, found by checking now and then (silently: offline is
 * normal), and installing it. One per window; the rail shows it.
 */
let state: AppUpdate = {
  status: "idle",
  version: null,
  error: null,
  selfUpdate: true,
};
let found: Update | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<AppUpdate>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The update now, for what shows it. */
export function useAppUpdate(): AppUpdate {
  return useSyncExternalStore(subscribe, () => state);
}

/** Checks for releases on `channel` while the window is open: at once, then
 *  every four hours. */
export function useUpdateChecks(channel: UpdateChannel): void {
  useEffect(() => {
    // iOS updates come from the App Store; the updater isn't built there.
    if (!canAutoUpdate) return;
    let cancelled = false;
    const checkOnce = () => {
      selfUpdateAllowed()
        .then((allowed) => {
          set({ selfUpdate: allowed });
          return updater.check(checkChannel(channel, allowed));
        })
        .then((update) => {
          if (cancelled || !update || state.status === "downloading") return;
          found = update;
          set({ status: "available", version: update.version, error: null });
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
}

/** Downloads and installs the release found, then relaunches. */
export async function installUpdate(): Promise<void> {
  if (!canAutoUpdate || !found || !(await selfUpdateAllowed())) return;
  set({ status: "downloading", error: null });
  try {
    // On Windows downloadAndInstall exits the process without Rust's
    // exit-time flush, so held-back writes go now.
    await flushPendingWrites();
    await found.downloadAndInstall();
    // macOS and Linux: anything changed during the download.
    await flushPendingWrites();
    await updater.releaseInstance();
    await relaunchApp();
  } catch (err) {
    set({ status: "error", error: explainError(err, currentStrings()) });
  }
}
