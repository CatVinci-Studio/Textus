import { fs } from "../../platform/ipc";
import { emitPluginEvent } from "../app-bridge";
import {
  onConventionReadersChange,
  readPendingConventions,
} from "./convention-readers";

/**
 * Tells plugins (files.onDidChangeConventions) when the open folder's
 * conventions change: another folder opened, or the window comes back from
 * the app whose settings they are. Asked only then, never on a timer.
 */
/** The folder last asked about, not a copy of the window's: an answer
 *  for one asked before it is dropped. */
let root: string | null = null;
let last: string | null = null;
let listening = false;

async function check(): Promise<void> {
  const asked = root;
  if (!asked) return;
  await readPendingConventions(asked);
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

// A plugin's reader came or went: its folders read again.
onConventionReadersChange(() => void check());
