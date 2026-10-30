import { schedule as scheduleIpc } from "../../platform/ipc-schedule";
import { listenToThisWindow, unlistenAll } from "../../platform/events";
import type { DocumentPlace } from "../app-bridge";
import { setNoticeSettings, type SettingsAccess } from "./schedule-notice";
import { windowIsDark } from "../views/theme-vars";
import { pluginPlatform } from "../manager";
import { currentAppState, watchAppState } from "./app-state";
import { runWaitingJobs } from "./run-jobs";

/**
 * An editor window's part in plugins' schedules: whether Textus is in front,
 * the background runs Rust hands it, and the file a clicked notification
 * opens - each taken once at start too, for what came before the window did.
 * Returns the function that stops listening.
 */
export function connectScheduleWindow(
  language: { current: string },
  settings: { current: ReturnType<SettingsAccess> },
  openFile: {
    current: (path: string, open: { place?: DocumentPlace }) => unknown;
  },
): () => void {
  const run = () =>
    void runWaitingJobs({
      language: language.current,
      platform: pluginPlatform(),
      theme: windowIsDark() ? "dark" : "light",
      appState: currentAppState,
    }).catch(() => {});
  const open = () =>
    void scheduleIpc
      .takeNotificationOpen()
      .then((target) => {
        if (target)
          openFile.current(
            target.path,
            target.line === undefined ? {} : { place: { line: target.line } },
          );
      })
      .catch(() => {});
  setNoticeSettings(() => settings.current);
  run();
  open();
  const stopState = watchAppState();
  const stopEvents = unlistenAll(
    listenToThisWindow("schedule-run", run),
    listenToThisWindow("notification-open", open),
  );
  return () => {
    setNoticeSettings(null);
    stopState();
    stopEvents();
  };
}
