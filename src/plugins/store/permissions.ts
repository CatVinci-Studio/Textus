import type { Strings } from "../../i18n/strings";
import type { Permission } from "./manifest";

/** A permission in plain words, as the install dialog and a plugin's page
 *  in Settings name it. */
export function permissionLabel(permission: Permission, t: Strings): string {
  switch (permission) {
    case "editor.read":
      return t.pluginPermEditorRead;
    case "editor.write":
      return t.pluginPermEditorWrite;
    case "editor.propose":
      return t.pluginPermEditorPropose;
    case "files.read":
      return t.pluginPermFilesRead;
    case "files.write":
      return t.pluginPermFilesWrite;
    case "clipboard":
      return t.pluginPermClipboard;
    case "editor.input":
      return t.pluginPermEditorInput;
    case "project.data":
      return t.pluginPermProjectData;
    case "ai.tools":
      return t.pluginPermAiTools;
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
