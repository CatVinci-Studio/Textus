import type { Strings } from "../i18n/strings";

/**
 * Commands other code adds to the app (docs/dev/plugin-api.md): an id, its
 * name, what it does, and optionally the shortcut that runs it. The window's
 * shortcuts (useGlobalShortcuts) run one whose combo no built-in shortcut
 * has taken; the editor's right-click menu lists the ones contributed to it
 * (editor-menu.ts, registerEditorMenuItems).
 *
 * The app's own actions are not commands yet - they keep their menus,
 * shortcuts and Settings rows as they were. This is the door a plugin's
 * actions come in through, and the one list they are found in.
 */
export interface CommandDef {
  /** Namespaced by its owner: "example.word-count". */
  id: string;
  title: (t: Strings) => string;
  /** Run from a shortcut or a menu with no arguments; a plugin's
   *  executeCommand may pass some. */
  run: (...args: unknown[]) => void;
  /** A combo as Settings writes them ("mod+shift+k"), or none. */
  shortcut?: string;
  /** Whether it can run now; left out, always. */
  enabled?: () => boolean;
}

const registered: CommandDef[] = [];

/** Adds a command; the returned function takes it away again. An id
 *  already taken is refused. */
export function registerCommand(command: CommandDef): () => void {
  if (registered.some((c) => c.id === command.id))
    throw new Error(`A command "${command.id}" is already registered.`);
  registered.push(command);
  return () => {
    const at = registered.indexOf(command);
    if (at >= 0) registered.splice(at, 1);
  };
}

/** Every command, in the order they were added. */
export function commands(): readonly CommandDef[] {
  return registered;
}

/** Runs the command with this id, if it is there and can run now; whether
 *  it ran. */
export function runCommand(id: string, args: unknown[] = []): boolean {
  const command = registered.find((c) => c.id === id);
  if (!command || command.enabled?.() === false) return false;
  command.run(...args);
  return true;
}

/** A command's key: the user's (Settings › Shortcuts, `overrides` by id,
 *  "" for none), else its own. */
export function commandShortcut(
  command: CommandDef,
  overrides: Record<string, string>,
): string | undefined {
  return overrides[command.id] ?? command.shortcut;
}

/** The command a combo runs, if one has it and can run now. */
export function commandForCombo(
  combo: string,
  overrides: Record<string, string> = {},
): CommandDef | undefined {
  return registered.find(
    (c) => commandShortcut(c, overrides) === combo && c.enabled?.() !== false,
  );
}
