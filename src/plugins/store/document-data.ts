import { plugins as pluginsIpc } from "../../platform/ipc";
import { pluginsSnapshot } from "./plugin-records";

/**
 * What plugins keep for one document (ctx.storage.document(path)): a key
 * `doc:<path>` in the plugin's global store, so it goes with the plugin
 * and not with the folder. A document renamed or moved takes it along -
 * a folder, its documents' - for every installed plugin.
 */
export const DOCUMENT_KEY_PREFIX = "doc:";

/** The key `from`'s data moves to when `from` becomes `to`, or null when
 *  the key is no document under `from`. */
export function movedDocumentKey(
  key: string,
  from: string,
  to: string,
): string | null {
  const own = DOCUMENT_KEY_PREFIX + from;
  if (key === own) return DOCUMENT_KEY_PREFIX + to;
  for (const sep of ["/", "\\"])
    if (key.startsWith(own + sep))
      return DOCUMENT_KEY_PREFIX + to + key.slice(own.length);
  return null;
}

/** Moves every plugin's data for `from` (a document, or a folder's
 *  documents) to `to`. A plugin it fails for keeps its data where it was. */
export async function moveDocumentData(from: string, to: string) {
  await Promise.all(
    pluginsSnapshot().records.map(async ({ id }) => {
      try {
        const keys = await pluginsIpc.storeKeys(id, "global", null);
        for (const key of keys) {
          const moved = movedDocumentKey(key, from, to);
          if (!moved) continue;
          const value = await pluginsIpc.storeGet(id, "global", null, key);
          await pluginsIpc.storeSet(id, "global", null, moved, value);
          await pluginsIpc.storeSet(id, "global", null, key, null);
        }
      } catch {
        // Its store isn't there (never written): nothing to move.
      }
    }),
  );
}
