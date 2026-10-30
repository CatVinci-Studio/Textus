import { commands, type AppState } from "./bindings/schedule";
import type * as Schedule from "./bindings/schedule";
import { isDesktopApp } from "./capabilities";
import { IpcError } from "./ipc-call";

// Not in ipc.ts nor ipc-call's table: only plugins' schedule code loads
// these, after startup.
export type JobSpec = Schedule.JobSpec_Deserialize;
export type ScheduledJob = Schedule.ScheduledJob_Serialize;
export type JobRun = Schedule.JobRun_Serialize;
export type NotificationSpec = Schedule.NotificationSpec_Deserialize;
export type { AppState };

type Commands = typeof commands;

/** A generated command, as ipc-call's `command`: failures as IpcError,
 *  and away from the desktop `fallback`, or a refusal without one. */
function desktop<K extends keyof Commands>(
  name: K,
  fallback: { value: Awaited<ReturnType<Commands[K]>> } | null,
  ...args: Parameters<Commands[K]>
): Promise<Awaited<ReturnType<Commands[K]>>> {
  if (!isDesktopApp)
    return fallback
      ? Promise.resolve(fallback.value)
      : Promise.reject(
          new IpcError(name, new Error("not available on this platform")),
        );
  const run = commands[name] as (
    ...a: Parameters<Commands[K]>
  ) => Promise<Awaited<ReturnType<Commands[K]>>>;
  return run(...args).catch((err: unknown) => {
    throw new IpcError(name, err);
  });
}

/** Plugins' scheduled jobs, notifications and background runs, kept and
 *  fired by Rust (src-tauri/src/schedule/). Desktop only. */
export const schedule = {
  set: (id: string, jobId: string, job: JobSpec, root: string | null) =>
    desktop("schedule_set", null, id, jobId, job, root),
  clear: (id: string, jobId: string) =>
    desktop("schedule_clear", { value: false }, id, jobId),
  list: (id: string) => desktop("schedule_list", { value: [] }, id),
  /** The background runs waiting for this window. */
  takeRuns: () => desktop("schedule_take_runs", { value: [] }),
  /** The hidden background window ran what it took. */
  hostIdle: () => desktop("background_host_idle", { value: undefined }),
  notify: (id: string, notification: NotificationSpec, root: string | null) =>
    desktop("notify_show", null, id, notification, root),
  /** The file a clicked notification opens, once. */
  takeNotificationOpen: () => desktop("notify_take_open", { value: null }),
  appState: () => desktop("app_state", { value: "active" }),
};
