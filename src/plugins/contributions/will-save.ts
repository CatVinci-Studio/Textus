/**
 * Plugins that may change a document just before it is saved. Each is asked
 * in turn and given at most a second, so a broken plugin never holds up a save.
 */
type Ask = (path: string, text: string) => Promise<string | null>;

const listeners = new Map<string, Ask>();

/** How long a save waits for one plugin. */
export const WILL_SAVE_MS = 1000;

export function setWillSave(plugin: string, on: boolean, ask: Ask): void {
  if (on) listeners.set(plugin, ask);
  else listeners.delete(plugin);
}

/** The text to save: as each listening plugin changed it, in turn. */
export async function runWillSave(path: string, text: string): Promise<string> {
  let current = text;
  for (const ask of listeners.values()) {
    const answer = await Promise.race([
      ask(path, current).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), WILL_SAVE_MS),
      ),
    ]);
    if (typeof answer === "string") current = answer;
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
