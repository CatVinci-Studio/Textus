import { headingsOf } from "../../utils/markdown-headings";
import { localize } from "../store/manifest";
import {
  pluginsSnapshot,
  runningPlugins,
  subscribePlugins,
  type PluginsSnapshot,
} from "../store/plugin-records";
import { createSubscribers } from "../../utils/store";

/**
 * What plugins show in the window bar's status area: a short text, its
 * tooltip, and a command a click runs. Gone with the plugin that set it,
 * but for those its manifest declares, shown while it is on.
 */

export interface StatusItem {
  /** "<plugin>/<its id>". */
  key: string;
  plugin: string;
  text: string;
  tooltip?: string;
  command?: string;
}

let items: StatusItem[] = [];
const subscribers = createSubscribers();

function publish(next: StatusItem[]) {
  items = next;
  subscribers.publish();
}

export const subscribeStatusItems = subscribers.subscribe;

/** Whether the window bar has any status to show: one set, or one a
 *  running plugin's manifest declares before its code has started. */
export function anyStatus(): boolean {
  return (
    items.length > 0 ||
    runningPlugins(pluginsSnapshot()).some(
      (p) => p.manifest.contributes.statusItems.length > 0,
    )
  );
}

export function subscribeAnyStatus(changed: () => void): () => void {
  const stopItems = subscribers.subscribe(changed);
  const stopPlugins = subscribePlugins(changed);
  return () => {
    stopItems();
    stopPlugins();
  };
}

export function statusItemsSnapshot(): StatusItem[] {
  return items;
}

/** The most a plugin's text runs to; a status, not a sentence. */
const MAX_TEXT = 40;

export function setStatusItem(
  plugin: string,
  id: string,
  item: { text: string; tooltip?: string; command?: string },
): void {
  const key = `${plugin}/${id}`;
  const next: StatusItem = {
    key,
    plugin,
    text: String(item.text ?? "").slice(0, MAX_TEXT),
    tooltip: item.tooltip ? String(item.tooltip) : undefined,
    command: item.command ? String(item.command) : undefined,
  };
  const at = items.findIndex((i) => i.key === key);
  publish(
    at < 0
      ? [...items, next]
      : items.map((i, index) => (index === at ? next : i)),
  );
}

export function removeStatusItem(plugin: string, id?: string): void {
  const kept = items.filter(
    (i) =>
      i.plugin !== plugin || (id !== undefined && i.key !== `${plugin}/${id}`),
  );
  if (kept.length !== items.length) publish(kept);
}

/** The items set, with those the plugins that are on declare and haven't
 *  set themselves, each plugin's declared first. */
export function withDeclared(
  set: StatusItem[],
  plugins: PluginsSnapshot,
  language: string,
): StatusItem[] {
  const taken = new Set(set.map((i) => i.key));
  const declared = runningPlugins(plugins).flatMap(({ id, manifest }) =>
    manifest.contributes.statusItems.flatMap((d) => {
      const key = `${id}/${d.id}`;
      if (taken.has(key)) return [];
      const tooltip = d.tooltip && localize(manifest, d.tooltip, language);
      return [
        {
          key,
          plugin: id,
          text: localize(manifest, d.text, language).slice(0, MAX_TEXT),
          ...(tooltip ? { tooltip } : {}),
          ...(d.command ? { command: d.command } : {}),
        },
      ];
    }),
  );
  return declared.length ? [...declared, ...set] : set;
}

/** A document's headings, from its Markdown, with the line each is on
 *  (0-based): the editor's (headingsOf). */
export function outlineOf(
  markdown: string,
): { level: number; text: string; line: number }[] {
  return headingsOf(markdown).map(({ level, text, line }) => ({
    level,
    text,
    line,
  }));
}
