import {
  schedule as scheduleIpc,
  type JobSpec,
  type NotificationSpec,
} from "../../platform/ipc-schedule";
import { clearJob, listJobs } from "../background/schedule";
import { currentAppState } from "../background/app-state";
import { pluginScheduled } from "../background/schedule-notice";
import { str, type Params, type PluginScope } from "./broker-scope";

/**
 * A plugin's jobs and notifications, and whether Textus is in front: kept
 * and checked again in Rust. `folder` is the folder a job's files and a
 * notification's file are in - the window's, or the job's in a background
 * run - given to Rust only with files.read.
 */
export function scheduleHandlers(p: PluginScope, folder: () => string | null) {
  const root = () => (p.info.granted.includes("files.read") ? folder() : null);
  return {
    "schedule.set": async ({ id, job }: Params) => {
      const spec = (job ?? {}) as JobSpec;
      if (spec.notify) p.need("notifications");
      if (spec.run) {
        p.need("background");
        if (!p.manifest().background)
          throw new Error(
            `A job's run needs "background" code in the manifest.`,
          );
      }
      const set = await scheduleIpc.set(p.id, str(id, "id"), spec, root());
      pluginScheduled(p.id);
      return set;
    },
    "schedule.clear": ({ id }: Params) => clearJob(p.id, str(id, "id")),
    "schedule.list": () => listJobs(p.id),
    "notify.show": (notification: Params) => {
      p.need("notifications");
      return scheduleIpc.notify(
        p.id,
        notification as unknown as NotificationSpec,
        root(),
      );
    },
    "app.state": () => currentAppState(),
  };
}
