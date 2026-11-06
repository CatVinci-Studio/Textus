import { fs } from "../../platform/ipc";
import { emitPluginEvent } from "../app-bridge";

/**
 * Tells plugins (files.onDidChangeConventions) when the open folder's
 * conventions change: another folder opened, or the window comes back from
 * the app whose settings they are. Asked only then, never on a timer.
 */
let root: string | null = null;
let last: string | null = null;
let listening = false;

async function check(): Promise<void> {
  const asked = root;
  if (!asked) return;
  const now = JSON.stringify(
    await fs.folderConventions(asked).catch(() => null),
  );
  if (asked !== root || now === last) return;
  const first = last === null;
  last = now;
  if (!first) emitPluginEvent("conventions", { root: asked });
}

export function watchConventions(path: string | null): void {
  if (path !== root) last = null;
  root = path;
  void check();
  if (listening) return;
  listening = true;
  window.addEventListener("focus", () => void check());
}
