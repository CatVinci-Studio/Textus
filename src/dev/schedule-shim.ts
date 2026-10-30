/**
 * The dev shim's stand-in for src-tauri/src/schedule/: plugins' jobs kept in
 * memory, fired only when a test says (`window.__devSchedule.fire`), with the
 * notifications they show recorded instead of shown.
 */

interface Notification {
  plugin: string;
  title: string;
  body?: string;
  open?: { path: string; line?: number };
}

interface ShimContext {
  allows(plugin: string, permission: string): boolean;
  emit(event: string, payload?: unknown): void;
}

export interface DevSchedule {
  jobs: Map<string, Map<string, Record<string, unknown>>>;
  notifications: Notification[];
  /** Fires a job as Rust's timer would. */
  fire(plugin: string, id: string): void;
  /** Clicks a recorded notification. */
  click(index: number): void;
  setAppState(state: "active" | "inactive" | "background"): void;
}

export function makeDevSchedule(ctx: ShimContext): {
  devSchedule: DevSchedule;
  command(cmd: string, args: Record<string, unknown>): Promise<unknown> | null;
} {
  const runs: Record<string, unknown>[] = [];
  let pendingOpen: Notification["open"] | null = null;
  let appState = "active";
  const devSchedule: DevSchedule = {
    jobs: new Map(),
    notifications: [],
    fire(plugin, id) {
      const job = devSchedule.jobs.get(plugin)?.get(id);
      if (!job) throw new Error(`No job ${plugin} ${id}`);
      job.lastFired = Date.now();
      const notify = job.notify as Omit<Notification, "plugin"> | undefined;
      if (notify && ctx.allows(plugin, "notifications"))
        devSchedule.notifications.push({ plugin, ...notify });
      if (job.run && ctx.allows(plugin, "background")) {
        runs.push({
          plugin,
          job: id,
          run: job.run,
          root: job.root ?? null,
          due: Date.now(),
        });
        ctx.emit("schedule-run");
      }
    },
    click(index) {
      pendingOpen = devSchedule.notifications[index]?.open ?? null;
      ctx.emit("notification-open");
    },
    setAppState(state) {
      appState = state;
      ctx.emit("app-state", state);
    },
  };
  // As Rust lists a job: without the folder it keeps for it.
  const shown = (job: Record<string, unknown>) => {
    const copy = { ...job };
    delete copy.root;
    return copy;
  };
  const refused = (plugin: string, permission: string) =>
    Promise.reject(`${plugin} was not granted ${permission}.`);
  const command = (cmd: string, args: Record<string, unknown>) => {
    const plugin = String(args.id ?? "");
    switch (cmd) {
      case "schedule_set": {
        const job = { ...(args.job as Record<string, unknown>) };
        if (job.notify && !ctx.allows(plugin, "notifications"))
          return refused(plugin, "notifications");
        if (job.run && !ctx.allows(plugin, "background"))
          return refused(plugin, "background");
        const kept = {
          ...job,
          id: String(args.jobId),
          catchUp: job.catchUp ?? "once",
          root: args.root ?? null,
          nextDue: Date.now() + 60_000,
          lastFired: null,
        };
        if (!devSchedule.jobs.has(plugin))
          devSchedule.jobs.set(plugin, new Map());
        devSchedule.jobs.get(plugin)!.set(String(args.jobId), kept);
        return Promise.resolve(shown(kept));
      }
      case "schedule_clear":
        return Promise.resolve(
          devSchedule.jobs.get(plugin)?.delete(String(args.jobId)) ?? false,
        );
      case "schedule_list":
        return Promise.resolve(
          [...(devSchedule.jobs.get(plugin)?.values() ?? [])].map(shown),
        );
      case "schedule_take_runs":
        return Promise.resolve(runs.splice(0));
      case "background_host_idle":
        return Promise.resolve(null);
      case "notify_show":
        if (!ctx.allows(plugin, "notifications"))
          return refused(plugin, "notifications");
        devSchedule.notifications.push({
          plugin,
          ...(args.notification as Omit<Notification, "plugin">),
        });
        return Promise.resolve(null);
      case "notify_take_open": {
        const open = pendingOpen;
        pendingOpen = null;
        return Promise.resolve(open);
      }
      case "app_state":
        return Promise.resolve(appState);
    }
    return null;
  };
  return { devSchedule, command };
}
