import { storage, type StoredSnapshot } from "../platform/ipc";
import { markLegacyImportSettled, readLocalJson } from "./boot";
import { trackWrite } from "./pending-writes";
import { readLegacyUiState } from "./ui-state";

/**
 * The one-time move out of localStorage (docs/dev/storage.md).
 *
 * On the first launch after the move, Rust has no settings.json and boots
 * every window with `legacyImport`. Each such window reads what its
 * localStorage holds and offers it here; Rust keeps the first offer and
 * answers every caller with the resulting settings, so windows that lost
 * the race end up on the same values. localStorage itself is left alone -
 * a downgrade to 0.9.6 still finds everything it had.
 */

/** The histories' localStorage keys before the move - still where the
 *  fallback (no Rust boot snapshot) keeps them. */
export const CHAT_HISTORY_KEY = "levis-chat-history";
export const CLIPBOARD_HISTORY_KEY = "levis-clipboard-history";

function localArray(key: string): unknown[] | null {
  const value = readLocalJson(key);
  return Array.isArray(value) ? value : null;
}

/** Offers this window's localStorage, with `settings` already normalised
 *  (the migrations in SettingsContext.tsx applied). Resolves to the
 *  settings Rust ended up with, or null if the call failed. */
export async function importLegacyStorage(
  settings: Record<string, unknown>,
): Promise<StoredSnapshot | null> {
  try {
    return await trackWrite(
      storage.settingsImportLegacy({
        settings,
        uiState: readLegacyUiState(),
        chatHistory: localArray(CHAT_HISTORY_KEY),
        clipboardHistory: localArray(CLIPBOARD_HISTORY_KEY),
      }),
    );
  } catch {
    return null;
  } finally {
    markLegacyImportSettled();
  }
}
