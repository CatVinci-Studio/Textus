import { pluginsSnapshot, windowInfo } from "../store/plugin-records";
import { localize } from "../store/manifest";
import { runCommand } from "../../app/commands";
import type {
  CompletionAnswer,
  CompletionContext,
  CompletionSource,
  PanelItem,
} from "../../editor/extension-points";

/**
 * Plugins' completions as sources of the / panel. A plugin is asked, and
 * started, only when its manifest's pattern matches before the caret; each
 * ask can be called off, and the plugin hears so.
 */

type Ask = (
  plugin: string,
  id: string,
  context: CompletionContext & { request: number },
) => Promise<unknown>;

let ask: Ask | null = null;
let cancel: ((plugin: string, request: number) => void) | null = null;
let nextRequest = 1;

/** The way to run a plugin's provider, starting it first, and to tell it
 *  an answer is no longer wanted. */
export function setCompletionAsker(
  run: Ask | null,
  callOff: ((plugin: string, request: number) => void) | null = null,
): void {
  ask = run;
  cancel = callOff;
}

const ICON = /^[a-z-]{1,24}$/;

/** What a plugin's item may hold; anything else is dropped. */
function pluginItem(plugin: string, value: unknown): PanelItem | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v.label !== "string" || typeof v.insert !== "string")
    return null;
  const item: PanelItem = { label: v.label, insert: v.insert };
  if (typeof v.detail === "string") item.detail = v.detail;
  if (typeof v.keywords === "string") item.keywords = v.keywords;
  if (
    typeof v.icon === "string" &&
    (ICON.test(v.icon) || v.icon.trimStart().startsWith("<svg"))
  )
    item.icon = v.icon;
  if (typeof v.replaceAfter === "number" && v.replaceAfter > 0)
    item.replaceAfter = Math.floor(v.replaceAfter);
  const command = v.command as { id?: unknown; args?: unknown } | undefined;
  if (command && typeof command.id === "string") {
    const id = command.id;
    const args = Array.isArray(command.args) ? command.args : [];
    // Only the plugin's own commands or the app's, as its menus run them.
    if (id.startsWith(`${plugin}.`) || id.startsWith("textus."))
      item.run = () => void runCommand(id, args);
  }
  return item;
}

/** A plugin's answer as the panel takes it: a whole list, or what it
 *  filtered itself. */
function pluginAnswer(plugin: string, value: unknown): CompletionAnswer {
  const v = value as { items?: unknown; complete?: unknown } | null;
  const whole = !!v && !Array.isArray(v) && v.complete === true;
  const raw = whole ? v.items : value;
  if (!Array.isArray(raw)) return null;
  const items: PanelItem[] = [];
  for (const entry of raw) {
    const item = pluginItem(plugin, entry);
    if (item) items.push(item);
  }
  return whole ? { items, complete: true } : items;
}

let cachedFor: unknown = null;
let cached: CompletionSource[] = [];

/** The completions of the plugins that are on and may read the editor. */
export function pluginCompletionSources(): readonly CompletionSource[] {
  const snapshot = pluginsSnapshot();
  if (snapshot === cachedFor) return cached;
  cachedFor = snapshot;
  cached = !snapshot.allOn
    ? []
    : snapshot.records.flatMap((r) => {
        const manifest = r.manifest;
        if (
          r.status !== "on" ||
          !manifest ||
          !r.granted.includes("editor.read")
        )
          return [];
        return manifest.contributes.completions.map((c): CompletionSource => ({
          id: c.id,
          owner: r.id,
          where: c.where,
          // Anchored at the caret: what is typed last.
          pattern: new RegExp(`(?:${c.pattern})$`, "u"),
          title: () =>
            localize(
              manifest,
              c.title ?? manifest.name,
              windowInfo().language(),
            ),
          provide: (context, signal) => {
            if (!ask) return null;
            const request = nextRequest++;
            signal.addEventListener("abort", () => cancel?.(r.id, request), {
              once: true,
            });
            return ask(r.id, c.id, { ...context, request }).then(
              (value) => pluginAnswer(r.id, value),
              () => null,
            );
          },
        }));
      });
  return cached;
}
