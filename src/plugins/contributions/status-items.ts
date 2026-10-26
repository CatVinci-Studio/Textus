/**
 * What plugins show in the window bar's status area, beside the word
 * count (window.setStatusItem): a short text, its tooltip, and a command
 * a click runs. Gone with the plugin that set it (PluginHost.stop).
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

/** A document's headings, from its Markdown: the ATX ones (`## Title`),
 *  outside code fences, with the line each is on (0-based). */
export function outlineOf(
  markdown: string,
): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = [];
  let fence: string | null = null;
  markdown.split("\n").forEach((line, index) => {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (fence === null) fence = open[1][0];
      else if (open[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading)
      out.push({ level: heading[1].length, text: heading[2], line: index });
  });
  return out;
}
