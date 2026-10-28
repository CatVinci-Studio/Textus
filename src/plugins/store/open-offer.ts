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
import {
  pluginName,
  pluginRecord,
  pluginsSnapshot,
  pluginText,
  setPluginEnabled,
} from "../manager";
import { matchesFilename, type SuggestKind } from "./manifest";
import { SUGGEST_KINDS } from "./manifest-parse";

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

/** How each kind a plugin can be suggested for shows in a document. */
const HOLDS: Record<SuggestKind, RegExp> = {
  wikilinks: /\[\[[^[\]\n]+\]\]/,
};

/** A document opened with something an official plugin works with
 *  (contributes.suggestFor) and no installed plugin that does: a note
 *  offers it, once ever for each kind. */
export async function offerForContent(content: string, t: Strings) {
  const offered = getUiState("pluginsOfferedFor");
  const shown = Array.isArray(offered) ? offered : [];
  const kinds = SUGGEST_KINDS.filter(
    (kind) => !shown.includes(kind) && HOLDS[kind].test(content),
  );
  if (!kinds.length) return;
  const covered = (kind: SuggestKind) =>
    pluginsSnapshot().records.some((r) =>
      r.manifest?.contributes.suggestFor.includes(kind),
    );
  const kind = kinds.find((k) => !covered(k));
  if (!kind) return;
  await loadCatalog().catch(() => {});
  const catalog = catalogSnapshot();
  if (catalog.status !== "ready") return;
  const item = catalog.items.find(
    (i) =>
      i.official &&
      i.manifest.contributes.suggestFor.includes(kind) &&
      !pluginRecord(i.id),
  );
  if (!item || covered(kind)) return;
  setUiState("pluginsOfferedFor", [...shown, kind]);
  const { manifest } = item;
  showNotice(
    OFFER_TEXT[kind](t)
      .replace("{name}", pluginName({ id: item.id, manifest }))
      .replace("{description}", pluginText({ manifest }, manifest.description)),
    {
      action: {
        label: t.pluginInstall,
        run: () => void installFromCatalog(item.id).catch(() => {}),
      },
    },
  );
}

const OFFER_TEXT: Record<SuggestKind, (t: Strings) => string> = {
  wikilinks: (t) => t.wikilinksPluginOffer,
};
