import type { PluginHost } from "./host/broker";

/** The plugins whose code is running, by id: their hosts. */
export const hosts = new Map<string, PluginHost>();

/** Stops a plugin's code, if it runs. */
export function stopHost(id: string) {
  hosts.get(id)?.stop();
  hosts.delete(id);
}
