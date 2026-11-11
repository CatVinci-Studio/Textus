import { logPluginMessage } from "../store/plugin-log";
import { mergeWholeText, textBlocks, type TextBlock } from "./save-blocks";

/**
 * Plugins that may change a document just before it is saved. Each is asked
 * in turn, in plugin id order, given the text as the one before left it and
 * at most a second, so a broken plugin never holds up a save. Only the
 * blocks it changed are written back, and a change that would change again
 * on a second run is dropped.
 */
interface WillSaveRequest {
  path: string;
  text: string;
  trigger: "manual" | "auto";
  blocks: TextBlock[];
}

/** The plugin's text for the document, or null for no change. */
type Ask = (request: WillSaveRequest) => Promise<string | null>;

const listeners = new Map<string, Ask>();

/** How long a save waits for one plugin. */
const WILL_SAVE_MS = 1000;

export function setWillSave(plugin: string, on: boolean, ask: Ask): void {
  if (on) listeners.set(plugin, ask);
  else listeners.delete(plugin);
}

/** Every listener, by plugin id: the order never depends on which started first. */
export function inIdOrder<T>(map: ReadonlyMap<string, T>): [string, T][] {
  return [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

async function answer(
  ask: Ask,
  request: Omit<WillSaveRequest, "blocks">,
  until: number,
): Promise<string> {
  const reply = await Promise.race([
    ask({ ...request, blocks: textBlocks(request.text) }).catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), Math.max(0, until - Date.now())),
    ),
  ]);
  return typeof reply === "string" ? reply : request.text;
}

/** The text to save: as each listening plugin changed it, in turn. */
export async function runWillSave(
  path: string,
  text: string,
  trigger: WillSaveRequest["trigger"] = "manual",
): Promise<string> {
  let current = text;
  for (const [plugin, ask] of inIdOrder(listeners)) {
    const until = Date.now() + WILL_SAVE_MS;
    const once = await answer(ask, { path, text: current, trigger }, until);
    if (once === current) continue;
    const log = (why: string) =>
      logPluginMessage(plugin, "warn", `Not saved: ${why}.`);
    // Lint rules that fight each other would change it on every save.
    const twice = await answer(ask, { path, text: once, trigger }, until);
    if (twice !== once) {
      log("its change changes again when it runs a second time");
      continue;
    }
    current = mergeWholeText(current, once, log);
  }
  return current;
}

/** Whether any plugin listens: saving skips the round trip when none does. */
export function hasWillSave(): boolean {
  return listeners.size > 0;
}

export function forgetWillSave(plugin: string): void {
  listeners.delete(plugin);
}
