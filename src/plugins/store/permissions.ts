import type { Strings } from "../../i18n/strings";
import type { Permission } from "./manifest";

/** Each permission's words, but `network:<host>`'s. */
const LABELS: Record<
  Exclude<Permission, `network:${string}`>,
  keyof Strings
> = {
  "editor.read": "pluginPermEditorRead",
  "editor.write": "pluginPermEditorWrite",
  "editor.propose": "pluginPermEditorPropose",
  "files.read": "pluginPermFilesRead",
  "files.write": "pluginPermFilesWrite",
  clipboard: "pluginPermClipboard",
  "editor.input": "pluginPermEditorInput",
  "project.data": "pluginPermProjectData",
  "ai.tools": "pluginPermAiTools",
  notifications: "pluginPermNotifications",
  background: "pluginPermBackground",
};

/** A permission in plain words, as the install dialog and a plugin's page
 *  in Settings name it. */
export function permissionLabel(permission: Permission, t: Strings): string {
  const label = LABELS[permission as keyof typeof LABELS];
  if (label) return t[label] as string;
  const host = permission.slice("network:".length);
  return host === "*"
    ? t.pluginPermNetworkAny
    : t.pluginPermNetwork.replace("{host}", host);
}

/** The HTTPS hosts a plugin was granted, for its webviews' frames. */
export function grantedHosts(granted: readonly Permission[]): string[] {
  return granted
    .filter((p) => p.startsWith("network:"))
    .map((p) => p.slice("network:".length))
    .filter((host) => !/^(localhost|127\.0\.0\.1)(:|$)/.test(host));
}
