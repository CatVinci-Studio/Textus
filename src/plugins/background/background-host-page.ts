import { schedule as scheduleIpc } from "../../platform/ipc-schedule";
import { loadSettings } from "../../prefs/SettingsContext";
import { windowIsDark } from "../views/theme-vars";
import { pluginPlatform } from "../manager";
import { setAppState } from "./app-state";
import { runWaitingJobs } from "./run-jobs";

/**
 * The hidden window Rust opens to run plugins' background code while no
 * window is open: it draws nothing, runs what is waiting until nothing is,
 * and tells Rust, which closes it.
 */
export async function runBackgroundHost(): Promise<void> {
  setAppState("background");
  const place = {
    language: loadSettings().language,
    platform: pluginPlatform(),
    theme: windowIsDark() ? ("dark" as const) : ("light" as const),
    appState: () => "background" as const,
  };
  try {
    while ((await runWaitingJobs(place)) > 0);
  } finally {
    await scheduleIpc.hostIdle().catch(() => {});
  }
}
