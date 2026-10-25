import type { Strings } from "../i18n/strings";
import type { PluginEventMap } from "./app-bridge";
import type { Permission, PluginManifest } from "./manifest";
import type { BrokerDeps, PluginRuntimeInfo } from "./broker";
import type { WebviewRecord } from "./webviews";

/**
 * What the calls of one running plugin (the broker-*.ts handlers) need of
 * it: who it is, what it was granted, and its way back to its own code.
 * PluginHost (broker.ts) is the one that makes it.
 */
export interface PluginScope {
  id: string;
  info: PluginRuntimeInfo;
  deps: BrokerDeps;
  /** Its name in the UI language, as dialogs title it. */
  name(): string;
  t(): Strings;
  manifest(): PluginManifest;
  /** Throws unless the user granted `permission`. */
  need(permission: Permission): void;
  /** The folder open in the sidebar; throws without files.read. */
  root(): string;
  /** One of the plugin's own webviews; throws for another's. */
  ownWebview(id: string): WebviewRecord;
  readOwnFile(rel: string): Promise<Uint8Array>;
  /** A call to the plugin's code. */
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Tells the plugin's code something, if it listens. */
  event<K extends keyof PluginEventMap>(name: K, data: PluginEventMap[K]): void;
}

/** A handler's parameters, as the runtime sends them: unchecked. */
export type Params = Record<string, unknown>;

export function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be text.`);
  return value;
}

export function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Where a plugin opens something: a tab of its own, beside, or in place
 *  of the tab in front. */
export type Where = "tab" | "beside" | "current";

export function whereOf(value: unknown): Where {
  return value === "beside" || value === "current" ? value : "tab";
}
