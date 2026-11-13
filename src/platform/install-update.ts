import { flushPendingWrites } from "../storage/pending-writes";
import { updater } from "./ipc";
import { isWindowsPlatform } from "./os";

/** Installs `update` and starts the new version: the one way every update
 *  button does it. Each unsaved document asks or is kept as a draft first,
 *  as at File > Quit. */
export async function installAndRelaunch(update: {
  rid: number;
  downloadAndInstall: () => Promise<void>;
}): Promise<void> {
  await flushPendingWrites();
  // The Windows installer ends the app at once: it runs after the quit.
  if (isWindowsPlatform()) {
    await updater.installAfterQuit(update.rid);
    return;
  }
  await update.downloadAndInstall();
  await flushPendingWrites();
  await updater.quitAndRelaunch();
}
