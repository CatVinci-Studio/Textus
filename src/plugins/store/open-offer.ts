import { basename } from "../../utils/path";
import type { Strings } from "../../i18n/strings";
import { showConfirm } from "../../ui/app-dialog";
import { showNotice } from "../../ui/notices";
import { getUiState, setUiState } from "../../storage/ui-state";
import {
  catalogSnapshot,
  installFromCatalog,
  loadCatalog,
  type CatalogItem,
} from "./catalog";
import { pluginName, pluginRecord, setPluginEnabled } from "../manager";
import { matchesFilename } from "./manifest";

/**
 * A file nothing opens (a PDF, a picture) when an official plugin would:
 * offered then and there, to install or turn on and open the file with.
 */

/** The official plugin in the catalog whose custom editor opens `path`. */
export function catalogEditorFor(
  path: string,
  items: CatalogItem[],
): CatalogItem | null {
  const name = basename(path);
  return (
    items.find(
      (item) =>
        item.official &&
        item.manifest.contributes.customEditors.some(
          (editor) =>
            editor.priority === "default" &&
            editor.filenamePatterns.some((p) => matchesFilename(p, name)),
        ),
    ) ?? null
  );
}

/** Asks to install or turn on the plugin that opens `path`; true when it
 *  is on now, so the file can be opened with it. */
export async function offerPluginToOpen(
  path: string,
  t: Strings,
): Promise<boolean> {
  await loadCatalog().catch(() => {});
  const catalog = catalogSnapshot();
  if (catalog.status !== "ready") return false;
  const item = catalogEditorFor(path, catalog.items);
  if (!item) return false;
  const installed = pluginRecord(item.id);
  const name = pluginName({ id: item.id, manifest: item.manifest });
  const file = basename(path);
  const ok = await showConfirm(
    (installed ? t.pluginOpenTurnOn : t.pluginOpenOffer)
      .replace("{name}", name)
      .replace("{file}", file),
    {
      okLabel: installed ? t.pluginOpenTurnOnButton : t.pluginOpenInstall,
      cancelLabel: t.cancel,
    },
  );
  if (!ok) return false;
  if (installed) await setPluginEnabled(item.id, true);
  else await installFromCatalog(item.id);
  return pluginRecord(item.id)?.status === "on";
}

const BACKLINKS = "catvinci.backlinks";
const WIKILINK = /\[\[[^[\]\n]+\]\]/;

/** A document written with [[wikilinks]], opened without Backlinks
 *  installed: a note offers it, once ever. */
export async function offerBacklinks(content: string, t: Strings) {
  if (!WIKILINK.test(content) || getUiState("linkPluginOffered") === true)
    return;
  if (pluginRecord(BACKLINKS)) return;
  await loadCatalog().catch(() => {});
  const catalog = catalogSnapshot();
  if (catalog.status !== "ready") return;
  const item = catalog.items.find((i) => i.id === BACKLINKS);
  if (!item || pluginRecord(BACKLINKS)) return;
  setUiState("linkPluginOffered", true);
  showNotice(
    t.backlinksOffer.replace(
      "{name}",
      pluginName({ id: item.id, manifest: item.manifest }),
    ),
    {
      action: {
        label: t.pluginInstall,
        run: () => void installFromCatalog(item.id).catch(() => {}),
      },
    },
  );
}
