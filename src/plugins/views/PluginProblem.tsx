import { emitToThisWindow } from "../../platform/menu-events";
import { FolderOpenIcon } from "../../engine/controls/icons";
import { canOpenFolder } from "../../platform/capabilities";
import { PLUGIN_OFF, windowInfo } from "../store/plugin-records";

/** The plugin's own words when it needs an open folder (textus.files,
 *  textus.metadata). */
const NEEDS_FOLDER = /No folder is open/;

/**
 * Where a plugin's page or list couldn't be made: a quiet note, never the
 * plugin's raw error - an open-folder button when it wants a folder, a
 * retry otherwise; nothing to press while the plugin is off. The error
 * itself is kept as the note's tip.
 */
export function PluginProblem({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  const t = windowInfo().strings();
  const off = error === PLUGIN_OFF;
  const folder = NEEDS_FOLDER.test(error);
  if (off)
    return (
      <div className="plugin-webview-problem">
        <p>{t.pluginTurnedOff}</p>
      </div>
    );
  return (
    <div className="plugin-webview-problem" title={error}>
      <p>{folder ? t.pluginNeedsFolder : t.pluginPageFailed}</p>
      {folder && canOpenFolder ? (
        <button
          type="button"
          className="tx-button"
          onClick={() => emitToThisWindow("menu-open-folder")}
        >
          <FolderOpenIcon />
          {t.menuOpenFolder}
        </button>
      ) : (
        !folder &&
        retry && (
          <button type="button" className="tx-button" onClick={retry}>
            {t.pluginsCatalogRetry}
          </button>
        )
      )}
    </div>
  );
}
