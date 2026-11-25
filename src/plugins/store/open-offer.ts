import { askForRequirements } from "./requirements";
import { canSwitch } from "./lifecycle";
import { WIKILINK_SOURCE } from "../../utils/note-link";
import { basename } from "../../utils/path";
import type { Strings } from "../../i18n/strings";
import { showMessage } from "../../engine/controls/app-dialog";
import {
  catalogSnapshot,
  installFromCatalog,
  loadCatalog,
  type CatalogItem,
} from "./catalog";
import { pluginMayRun, pluginRecord, pluginsSnapshot } from "./plugin-records";
import { setPluginEnabled } from "../plugin-switches";
import { matchesFilename } from "./manifest";
import { type SuggestKind } from "./manifest-types";
import { SUGGEST_KINDS } from "./manifest-parse";
import { pluginOffer } from "./offer-plugin";
import { showPluginCard, type CardRequest } from "./plugin-card";
import { explainError } from "../../utils/error-explain";

/**
 * A file nothing opens (a PDF, a picture) when an official plugin would:
 * offered then and there, to install or turn on and open the file with.
 */

/** The official plugin in the catalog whose custom editor opens `path`,
 *  or that edits it as text. */
function catalogEditorFor(
  path: string,
  items: CatalogItem[],
): CatalogItem | null {
  const name = basename(path);
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return (
    items.find(
      ({ official, manifest: { contributes } }) =>
        official &&
        (contributes.customEditors.some(
          (editor) =>
            editor.priority === "default" &&
            editor.filenamePatterns.some((p) => matchesFilename(p, name)),
        ) ||
          contributes.textFiles.some((type) => type.extensions.includes(ext))),
    ) ?? null
  );
}

/** Installs the card's plugin, or turns it on, asking for its permissions
 *  first; whether it is on now. */
export async function takeUp(
  request: CardRequest,
  t: Strings,
): Promise<boolean> {
  try {
    if (request.installed) await setPluginEnabled(request.plugin, true);
    else await installFromCatalog(request.plugin);
    await askForRequirements(request.plugin, t);
  } catch (error) {
    void showMessage(explainError(error, t), {
      title: t.pluginsTitle,
      tone: "error",
    });
  }
  return pluginMayRun(pluginRecord(request.plugin));
}

/** Suggests the plugin that opens `path` on the card: "on" when it is on
 *  now, so the file can be opened with it; "system" when the user chose
 *  the system's app; "declined" for Later or ×; "muted" when the user
 *  asked not to be offered it again; "dropped" when a later tap's card took
 *  its place; "none" when no official plugin opens it. */
export async function offerPluginToOpen(
  path: string,
  t: Strings,
): Promise<"on" | "system" | "declined" | "muted" | "dropped" | "none"> {
  await loadCatalog().catch(() => {});
  const catalog = catalogSnapshot();
  if (catalog.status !== "ready") return "none";
  const item = catalogEditorFor(path, catalog.items);
  if (!item) return "none";
  const record = pluginRecord(item.id);
  // Installed but unable to switch on here (it needs a newer Textus): no
  // offer that can't be kept.
  if (record && !canSwitch(record.status)) return "none";
  const installed = !!record;
  const request: CardRequest = {
    plugin: item.id,
    situation: { type: "open", path },
    installed,
  };
  const answer = await showPluginCard(request);
  if (answer === "system") return "system";
  if (answer === "muted") return "muted";
  if (answer === "superseded") return "dropped";
  if (answer !== "install") return "declined";
  return (await takeUp(request, t)) ? "on" : "declined";
}

/** How each kind a plugin can be suggested for shows in a document. */
const HOLDS: Record<SuggestKind, RegExp> = {
  wikilinks: new RegExp(WIKILINK_SOURCE),
};

/** A document opened with something an official plugin works with
 *  (contributes.suggestFor) and no installed plugin that does: the card
 *  suggests it, each kind until the user says × or Later three times. */
export async function offerForContent(content: string, t: Strings) {
  const kinds = SUGGEST_KINDS.filter((kind) => HOLDS[kind].test(content));
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
  const request: CardRequest = {
    plugin: item.id,
    situation: { type: "content", kind },
    installed: false,
  };
  if ((await showPluginCard(request)) === "install") await takeUp(request, t);
}

/** textus.offerPlugin, with the market catalog and the suggestion card. */
export const offerPlugin = pluginOffer({
  official: async (id) => {
    await loadCatalog().catch(() => {});
    const catalog = catalogSnapshot();
    return (
      catalog.status === "ready" &&
      catalog.items.some((i) => i.official && i.id === id)
    );
  },
  status: (id) => pluginRecord(id)?.status,
  card: showPluginCard,
  takeUp,
});
