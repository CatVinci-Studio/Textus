import {
  addEmbedProvider,
  refreshEmbeds,
  setEmbedOwners,
  setEmbedStarter,
  type EmbedContent,
  type EmbedKind,
} from "../../editor/extension-points";

import { onPluginEvent } from "../app-bridge";
import { claim, onOwnersChanged, ownerOf } from "./owners";
import { FILE_WRITTEN_EVENT } from "../../utils/events";

/** The embed providers each running plugin registered, to take away. */
const registered = new Map<string, Map<string, () => void>>();

/** Embeds of a file follow it as it is saved, by a tab or a plugin; each
 *  kind is drawn by its owner in the one registry ("embed:note"). */
let watching = false;
function watchSaves(): void {
  if (watching) return;
  watching = true;
  setEmbedOwners((kind) => ownerOf(`embed:${kind}`));
  onOwnersChanged(() => refreshEmbeds());
  onPluginEvent("didSave", ({ path }) => refreshEmbeds(path));
  window.addEventListener(FILE_WRITTEN_EVENT, (event) => {
    const path = (event as CustomEvent<unknown>).detail;
    if (typeof path === "string") refreshEmbeds(path);
  });
}

/** Plugin `plugin`'s provider `id` for `kinds`, answered by `ask`. */
export function setPluginEmbed(
  plugin: string,
  id: string,
  kinds: readonly EmbedKind[],
  ask: (target: unknown, signal: AbortSignal) => Promise<unknown>,
): void {
  forgetEmbed(plugin, id);
  watchSaves();
  const claims = kinds.map((kind) => claim(`embed:${kind}`, plugin));
  const removeProvider = addEmbedProvider({
    owner: plugin,
    id,
    kinds,
    provide: async (target, signal) => {
      const v = (await ask(target, signal)) as EmbedContent | null;
      return v && typeof v.markdown === "string"
        ? { markdown: v.markdown, title: v.title ?? null }
        : null;
    },
  });
  const remove = () => {
    removeProvider();
    claims.forEach((release) => release());
  };
  const own = registered.get(plugin) ?? new Map<string, () => void>();
  own.set(id, remove);
  registered.set(plugin, own);
}

export function forgetEmbed(plugin: string, id: string): void {
  registered.get(plugin)?.get(id)?.();
  registered.get(plugin)?.delete(id);
}

/** A plugin stopped: the next claimant of each kind takes over. */
export function forgetEmbeds(plugin: string): void {
  for (const remove of registered.get(plugin)?.values() ?? []) remove();
  registered.delete(plugin);
}

export function embedRefreshed(plugin: string): void {
  if (registered.get(plugin)?.size) refreshEmbeds();
}

/** Plugins that declare embeds and haven't started: started the first time
 *  an embed of their kind is in sight. */
const waiting = new Map<string, readonly EmbedKind[]>();

export function startOnEmbed(
  plugin: string,
  kinds: readonly EmbedKind[],
  start: (plugin: string) => void,
): () => void {
  waiting.set(plugin, kinds);
  setEmbedStarter((kind) => {
    for (const [id, declared] of waiting)
      if (declared.includes(kind)) {
        waiting.delete(id);
        start(id);
      }
    if (!waiting.size) setEmbedStarter(null);
  });
  return () => waiting.delete(plugin);
}
