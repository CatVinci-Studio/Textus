import { flushPendingWrites } from "../storage/pending-writes";
import { relaunchApp } from "./app-info";
import { updater } from "./ipc";

/** Installs `update` and starts the new version: the one way every update
 *  button does it. */
export async function installAndRelaunch(update: {
  downloadAndInstall: () => Promise<void>;
}): Promise<void> {
  // On Windows downloadAndInstall exits the process without Rust's
  // exit-time flush, so held-back writes go now.
  await flushPendingWrites();
  await update.downloadAndInstall();
  // macOS and Linux: anything changed during the download; then the
  // single-instance claim let go, or the relaunch hands itself to the old
  // process (Linux).
  await flushPendingWrites();
  await updater.releaseInstance();
  await relaunchApp();
}
