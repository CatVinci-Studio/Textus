import { grants } from "../grants";
import type { Permission } from "../store/manifest";
import { aiState } from "../ai-state";
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
 * and checked again in Rust. The plugin's folder goes to Rust with
 * files.read (a job's or a notification's files) or project.data (what a
 * job's run keeps for the folder).
 */
export function scheduleHandlers(p: PluginScope) {
  const granted = (...any: Permission[]) =>
    any.some((g) => grants(p.info.granted, g)) ? p.folder() : null;
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
      const set = await scheduleIpc.set(
        p.id,
        str(id, "id"),
        spec,
        granted("files.read", "project.data"),
      );
      pluginScheduled(p.id);
      return set;
    },
    "schedule.clear": ({ id }: Params) => clearJob(p.id, str(id, "id")),
    "schedule.list": () => listJobs(p.id),
    "notify.show": (notification: Params) => {
      return scheduleIpc.notify(
        p.id,
        notification as unknown as NotificationSpec,
        granted("files.read"),
      );
    },
    "app.state": () => currentAppState(),
    "ai.state": () => aiState(),
  };
}
