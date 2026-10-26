/**
 * A plugin's lifecycle: its status (PluginRecord.status, what Settings
 * shows) and what moves it on - one table, so the manager's switches,
 * failures and reloads can't each decide it their own way. Pure; the
 * manager (manager.ts) runs the effects that go with a move - starting or
 * stopping the host, registering or withdrawing what it adds, saving the
 * switch in Rust.
 *
 * The host is a second, runtime state beside the status: not started, it
 * starts on the plugin's first activation (a command, a view, a custom
 * editor, a settings page, `onStartupFinished`) and runs until the status
 * leaves `on`, every plugin is switched off, or it is reloaded or
 * uninstalled. Only a plugin that `canRun` has a host.
 *
 * ```
 *            read                 enable             fail
 *   (files) ──────▶ off ◀─────────────────▶ on ──────────────▶ failed
 *              │        disable / revoke       ◀──────────────
 *              │                                    enable
 *              ├──▶ broken        (its manifest can't be read)
 *              └──▶ incompatible  (made for another Textus)
 * ```
 */

export type PluginStatus =
  /** Switched off. */
  | "off"
  /** On, and running or ready to. */
  | "on"
  /** Its manifest couldn't be read; `problem` says why. */
  | "broken"
  /** Made for another version of Textus. */
  | "incompatible"
  /** Turned off because it failed; `problem` says why. */
  | "failed";

export type PluginEvent =
  /** Its files were read (on load, install, reload): what its manifest is,
   *  and whether its switch, saved in Rust, is on. */
  | {
      type: "read";
      manifest: "ok" | "broken" | "incompatible";
      enabled: boolean;
    }
  /** Switched on, its permissions granted. */
  | { type: "enable" }
  /** Switched off. */
  | { type: "disable" }
  /** Its host stopped answering, threw on activation or erred too often
   *  (broker.ts' watchdog). */
  | { type: "fail" }
  /** A permission taken back: without it the plugin can't run. */
  | { type: "revoke" };

export function nextStatus(
  status: PluginStatus | null,
  event: PluginEvent,
): PluginStatus {
  if (event.type === "read") {
    if (event.manifest !== "ok") return event.manifest;
    return event.enabled ? "on" : "off";
  }
  // Nothing moves a plugin whose manifest can't be used but reading it
  // again.
  if (status === null || status === "broken" || status === "incompatible")
    return status ?? "off";
  switch (event.type) {
    case "enable":
      return "on";
    case "disable":
      return "off";
    case "fail":
      return status === "on" ? "failed" : status;
    case "revoke":
      return status === "on" ? "off" : status;
  }
}

/** Whether a plugin may run now: on, with every plugin switched on. */
export function canRun(status: PluginStatus, allOn: boolean): boolean {
  return status === "on" && allOn;
}

/** Whether its switch in Settings can be turned: not for a manifest that
 *  can't be used. */
export function canSwitch(status: PluginStatus): boolean {
  return status !== "broken" && status !== "incompatible";
}
