import { fs } from "../../platform/ipc";
import type { Found_Deserialize } from "../../platform/bindings/files";
import { nameConventionsApp } from "../../prefs/image-folder";

/**
 * Plugins' readers of other apps' folder conventions
 * (`files.registerConventionReader`). The core finds each reader's marker
 * file; the reader is handed its text once and answers what the app sets,
 * which the core then offers like any other app's settings.
 */

interface Reader {
  plugin: string;
  marker: string;
  notes: boolean;
  read(root: string, text: string): Promise<unknown>;
}

/** By app: `<plugin id>#<reader id>`. */
const readers = new Map<string, Reader>();
/** The last list sent to the core, waited for before asking it. */
let sent: Promise<unknown> = Promise.resolve();
let changed: () => void = () => {};

/** How long a reader may take to answer. */
const READ_WAIT_MS = 5000;

/** Called with each change to the readers, once set. */
export function onConventionReadersChange(listener: () => void): void {
  changed = listener;
}

function send(): void {
  const list = [...readers].map(([app, r]) => ({
    app,
    marker: r.marker,
    notes: r.notes,
  }));
  sent = fs.conventionReaders(list).catch(() => {});
  void sent.then(() => changed());
}

export function addConventionReader(
  app: string,
  label: string,
  reader: Reader,
): void {
  readers.set(app, reader);
  nameConventionsApp(app, label);
  send();
}

export function removeConventionReader(app: string): void {
  if (!readers.delete(app)) return;
  nameConventionsApp(app, null);
  send();
}

/** Takes away a stopped plugin's readers. */
export function stopPluginConventionReaders(plugin: string): void {
  const gone = [...readers].filter(([, r]) => r.plugin === plugin);
  for (const [app] of gone) {
    readers.delete(app);
    nameConventionsApp(app, null);
  }
  if (gone.length) send();
}

/** Each marker file above `path` no reader has answered for, read. */
export async function readPendingConventions(path: string): Promise<void> {
  if (!readers.size) return;
  await sent;
  const pending = await fs.conventionsPending(path).catch(() => []);
  await Promise.all(
    pending.map(async ({ app, root, text }) => {
      const reader = readers.get(app);
      if (!reader) return;
      const found = await Promise.race([
        reader.read(root, text).catch(() => null),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), READ_WAIT_MS),
        ),
      ]);
      const answer =
        found && typeof found === "object"
          ? (found as Found_Deserialize)
          : null;
      // An answer the core can't take counts as nothing found.
      await fs
        .conventionsAnswer(app, root, text, answer)
        .catch(() => fs.conventionsAnswer(app, root, text, null))
        .catch(() => {});
    }),
  );
}
