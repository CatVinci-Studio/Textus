/**
 * A plugin's lifecycle status and what moves it on, in one pure table so
 * switches, failures and reloads can't each decide it their own way. The host
 * starts on first activation and runs while the status is `on`.
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
  /** Its files were read: its manifest, and whether its saved switch is on. */
  | {
      type: "read";
      manifest: "ok" | "broken" | "incompatible";
      enabled: boolean;
    }
  /** Switched on, its permissions granted. */
  | { type: "enable" }
  /** Switched off. */
  | { type: "disable" }
  /** Its host stopped answering, threw on activation or erred too often. */
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
  // Only reading it again moves a plugin whose manifest can't be used.
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
