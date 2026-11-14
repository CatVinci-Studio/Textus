import { headingsOf } from "../../utils/markdown-lines";
import { localize } from "../store/manifest";
import { runningPlugins, type PluginsSnapshot } from "../store/plugin-records";

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
const listeners = new Set<() => void>();

function publish(next: StatusItem[]) {
  items = next;
  for (const listener of listeners) listener();
}

export function subscribeStatusItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  return headingsOf(markdown);
}
