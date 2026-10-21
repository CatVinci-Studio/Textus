import type { Strings } from "../i18n/strings";
import type { Permission } from "./manifest";

/** A permission in plain words, as the install dialog and a plugin's page
 *  in Settings name it. */
export function permissionLabel(permission: Permission, t: Strings): string {
  switch (permission) {
    case "document.read":
      return t.pluginPermDocumentRead;
    case "document.propose":
      return t.pluginPermDocumentPropose;
    case "workspace.read":
      return t.pluginPermWorkspaceRead;
    case "workspace.write":
      return t.pluginPermWorkspaceWrite;
    case "clipboard":
      return t.pluginPermClipboard;
  }
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
