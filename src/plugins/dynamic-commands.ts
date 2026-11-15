import { registerCommand } from "../registry/commands";
import { getActiveDocument } from "./app-bridge";
import { addContribution } from "./contributions/plugin-contributions";
import { pluginRecord } from "./store/plugin-records";

/** Commands a plugin's code registered beyond its manifest's. */
const dynamicCommands = new Map<string, () => void>();
/** Commands that work on the document in front: offered only with one
 *  (registerEditorCommand). */
const editorCommands = new Set<string>();

function remove(command: string) {
  dynamicCommands.get(command)?.();
  dynamicCommands.delete(command);
}

export function commandRegistered(
  id: string,
  command: string,
  editor: boolean,
  run: (args: unknown[]) => void,
) {
  const declared = pluginRecord(id)?.manifest?.contributes.commands.some(
    (c) => c.command === command,
  );
  if (editor) editorCommands.add(command);
  if (declared || dynamicCommands.has(command)) return;
  dynamicCommands.set(
    command,
    registerCommand({
      id: command,
      title: () => command,
      // Not declared, so no title: a row's action, not for the palette.
      palette: false,
      run: (...args) => run(args),
      enabled: () => !editorCommands.has(command) || !!getActiveDocument(),
    }),
  );
  addContribution(id, () => remove(command));
}

export function commandUnregistered(id: string, command: string) {
  // Only its own, as registering is.
  if (!command.startsWith(`${id}.`)) return;
  editorCommands.delete(command);
  remove(command);
}
