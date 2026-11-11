import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import type { Permission } from "./manifest";

/** Each permission's words, but those naming a host or a plugin. */
export const PERMISSION_LABELS: Record<
  Exclude<Permission, `network:${string}` | `commands:${string}`>,
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
  agents: "pluginPermAgents",
};

/** A permission in plain words, as the install dialog and a plugin's page
 *  in Settings name it. */
export function permissionLabel(permission: Permission, t: Strings): string {
  const label = PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS];
  if (label) return t[label] as string;
  if (permission.startsWith("commands:"))
    return fill(t.pluginPermCommands, {
      plugin: permission.slice("commands:".length),
    });
  const host = permission.slice("network:".length);
  return host === "*"
    ? t.pluginPermNetworkAny
    : fill(t.pluginPermNetwork, { host });
}

/** Whether a `network:` grant covers `host` on `port`, by the rule the
 *  Rust side fetches by: the host, `host:port`, `*.domain` for it and its
 *  subdomains, or `*`; case aside. */
export function hostAllowed(
  granted: readonly string[],
  host: string,
  port: number,
): boolean {
  const name = host.toLowerCase();
  return granted.some((g) => {
    if (!g.startsWith("network:")) return false;
    const rule = g.slice("network:".length).toLowerCase();
    if (rule === "*") return true;
    const colon = rule.lastIndexOf(":");
    const rulePort = colon < 0 ? null : Number(rule.slice(colon + 1));
    const ruleHost = colon < 0 ? rule : rule.slice(0, colon);
    if (rulePort !== null && rulePort !== port) return false;
    if (!ruleHost.startsWith("*.")) return name === ruleHost;
    const domain = ruleHost.slice(2);
    return name === domain || name.endsWith(`.${domain}`);
  });
}

/** The HTTPS hosts a plugin was granted, for its webviews' frames. */
export function grantedHosts(granted: readonly Permission[]): string[] {
  return granted
    .filter((p) => p.startsWith("network:"))
    .map((p) => p.slice("network:".length))
    .filter((host) => !/^(localhost|127\.0\.0\.1)(:|$)/.test(host));
}
