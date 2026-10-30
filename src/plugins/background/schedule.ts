import {
  schedule as scheduleIpc,
  type ScheduledJob,
} from "../../platform/ipc-schedule";

/**
 * A plugin's scheduled jobs, as its page in Settings lists them. Rust keeps
 * them (src-tauri/src/schedule/jobs.rs, whose JobSpec, ScheduledJob,
 * NotificationSpec, NotificationOpen and JobRun these mirror):
 *
 *   ScheduledJob = { id, at? | every? | daily?, catchUp: "once" | "skip",
 *                    notify?: { title, body, open?: { path, line? } },
 *                    run?: string, nextDue: ms | null, lastFired: ms | null }
 *
 * `nextDue` is null once an `at` job has fired; a turned-off plugin's jobs
 * keep their `nextDue` and wait.
 */
export type { ScheduledJob };

export function listJobs(pluginId: string): Promise<ScheduledJob[]> {
  return scheduleIpc.list(pluginId);
}

/** Takes one of a plugin's jobs away; whether it was there. */
export function clearJob(pluginId: string, jobId: string): Promise<boolean> {
  return scheduleIpc.clear(pluginId, jobId);
}
