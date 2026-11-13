import { forgetPluginSettings } from "./store/plugin-settings";
import { plugins as pluginsIpc, type PluginFile } from "../platform/ipc";
import type { Permission } from "./store/manifest";
import { contributingPlugins } from "./contributions/plugin-contributions";
import { canRun, canSwitch, nextStatus } from "./store/lifecycle";
import {
  pluginRecord,
  pluginMayRun,
  pluginsSnapshot,
  publish,
  update,
} from "./store/plugin-records";
import { hosts, stopHost } from "./running-hosts";
import { askPermissions } from "./store/ask-permissions";
import { apply, loadPlugins, withdraw } from "./manager";

/**
 * Switching plugins on and off, granting and revoking, installing and
 * removing: each told to the backend, which owns the state, and applied in
 * this window (loadPlugins brings the others in line).
 */

/** Settings' switch for one plugin. Turning it on asks for its
 *  permissions first; refused, it stays or goes off. */
export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const record = pluginRecord(id);
  if (!record || !record.manifest) return;
  if (!canSwitch(record.status)) return;
  const granted = on ? await askPermissions(record) : null;
  // Refused: off, even one already on (an update asking for more).
  if (!on || (!granted && record.status === "on")) {
    stopHost(id);
    withdraw(id);
    await pluginsIpc.set(id, false, record.granted);
    update(id, {
      status: nextStatus(record.status, { type: "disable" }),
      problem: undefined,
    });
    return;
  }
  if (!granted) return;
  await pluginsIpc.set(id, true, granted);
  const next = {
    ...record,
    granted,
    status: nextStatus(record.status, { type: "enable" }),
    problem: undefined,
  };
  update(id, next);
  if (pluginMayRun(next)) apply(next);
}

export async function revokePermission(
  id: string,
  permission: Permission,
): Promise<void> {
  const record = pluginRecord(id);
  if (!record) return;
  const granted = record.granted.filter((p) => p !== permission);
  stopHost(id);
  withdraw(id);
  // Without a permission it asks for, it can't run: off until granted.
  await pluginsIpc.set(id, false, granted);
  update(id, {
    granted,
    status: nextStatus(record.status, { type: "revoke" }),
  });
}

/** Settings › Extensions › Plugins › Plugins: every plugin at once. */
export async function setAllPlugins(on: boolean): Promise<void> {
  await pluginsIpc.setAll(on);
  if (!on) for (const id of [...hosts.keys()]) stopHost(id);
  if (!on) for (const id of contributingPlugins()) withdraw(id);
  publish({ allOn: on });
  for (const record of pluginsSnapshot().records)
    if (canRun(record.status, on)) apply(record);
}

export async function reloadPlugin(id: string): Promise<void> {
  stopHost(id);
  withdraw(id);
  await loadPlugins(true);
}

/** A package or folder at `source`, or files Textus AI wrote, installed. */
export async function installPlugin(
  source: string | PluginFile[],
): Promise<string> {
  const installed = await (typeof source === "string"
    ? pluginsIpc.install(source)
    : pluginsIpc.installFiles(source));
  stopHost(installed.id);
  await loadPlugins(true);
  return installed.id;
}

export async function loadDevPlugin(path: string): Promise<string> {
  const loaded = await pluginsIpc.loadDev(path);
  stopHost(loaded.id);
  await loadPlugins(true);
  return loaded.id;
}

export async function uninstallPlugin(id: string): Promise<void> {
  stopHost(id);
  withdraw(id);
  await forgetPluginSettings(id);
  await pluginsIpc.uninstall(id);
  await loadPlugins(true);
}
