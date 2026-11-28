import { changeSettings, loadSettings } from "./settings-store";
import { getUiState, setUiState, uiStateReady } from "../storage/ui-state";

/** The tree's "Show Hidden Files" used to be a view state, not a setting.
 *  Whoever had it on keeps it on: the setting is turned on once (never over
 *  a setting already on), and the old value is left "0" so this runs once. */
export async function migrateTreeHidden(): Promise<void> {
  await uiStateReady();
  if (getUiState("fileTreeHidden") !== "1") return;
  if (!loadSettings().showHiddenFiles)
    changeSettings({ showHiddenFiles: true });
  setUiState("fileTreeHidden", "0");
}
