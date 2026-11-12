import { flushPendingWrites } from "../storage/pending-writes";
import { updater } from "./ipc";
import { isWindowsPlatform } from "./os";

/** Installs `update` and starts the new version: the one way every update
 *  button does it. */
export async function installAndRelaunch(update: {
  downloadAndInstall: () => Promise<void>;
}): Promise<void> {
  await flushPendingWrites();
  if (isWindowsPlatform()) {
    // The installer ends the process at once, with no Quit: every window's
    // drafts and held-back writes go first.
    await updater.flushDrafts();
    await new Promise((done) => setTimeout(done, 300));
    await update.downloadAndInstall();
    return;
  }
  await update.downloadAndInstall();
  await flushPendingWrites();
  // As File > Quit: each unsaved document asks or is kept as a draft, then
  // the new version starts.
  await updater.quitAndRelaunch();
}
