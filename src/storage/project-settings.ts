import { trackWrite } from "./pending-writes";
import { fs } from "../platform/ipc";

/** A project's own settings, which go with the folder: plugin values under
 *  "plugins", the folder's conventions under "conventions". */
export const projectSettingsFile = (root: string) =>
  `${root.replace(/[\\/]+$/, "")}/.textus/settings.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The project's settings file as a whole, read as the folder's
 *  conventions are (comments allowed); {} when it isn't there or can't be
 *  read. */
export async function readProjectSettings(
  root: string,
): Promise<Record<string, unknown>> {
  const parsed: unknown = await fs.projectSettings(root).catch(() => ({}));
  return isRecord(parsed) ? parsed : {};
}

/** The file to change: {} only when there is none yet. One that is there
 *  but doesn't read as settings stops the write - it would lose its keys. */
async function settingsToChange(
  root: string,
): Promise<Record<string, unknown>> {
  const path = projectSettingsFile(root);
  let text: string;
  try {
    text = await fs.readTextFile(path);
  } catch (err) {
    if ((await fs.fileMtimeMs(path).catch(() => null)) === null) return {};
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${path} isn't a settings file.`);
  return parsed;
}

/** Each project's settings writes, one after another: two at once read the
 *  same file and the second's write dropped the first's key. */
const queues = new Map<string, Promise<void>>();

/** Writes the project's settings file with `key` changed by `change`, every
 *  other key kept, after any write to it still going; a closing window
 *  waits for it. */
export function updateProjectSettings(
  root: string,
  key: string,
  change: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const next = (queues.get(root) ?? Promise.resolve()).then(async () => {
    const file = await settingsToChange(root);
    const current = isRecord(file[key]) ? file[key] : {};
    await fs.writeTextFile(
      projectSettingsFile(root),
      JSON.stringify({ ...file, [key]: change(current) }, null, 2) + "\n",
    );
  });
  const settled = next.catch(() => undefined);
  queues.set(root, settled);
  return trackWrite(next);
}
