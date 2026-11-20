import { createSubscribers } from "../../utils/store";
/**
 * Who gives the content of `![[note]]` embeds: plugins register here
 * (contributes.embeds) and the editor draws what the owner of each kind
 * answers. Who owns a kind is the plugin host's call (its one registry);
 * without one, the first registered.
 */

export type EmbedKind = "note" | "heading" | "block";

/** What an embed points at, resolved as a click would. */
interface EmbedTarget {
  path: string;
  heading?: string;
  block?: string;
  alias?: string;
}

export interface EmbedContent {
  /** Drawn read-only; links and pictures read from `target.path`'s folder. */
  markdown: string;
  title?: string | null;
}

export interface EmbedProvider {
  /** The plugin's id. */
  owner: string;
  id: string;
  kinds: readonly EmbedKind[];
  provide(
    target: EmbedTarget,
    signal: AbortSignal,
  ): Promise<EmbedContent | null>;
}

const providers: EmbedProvider[] = [];
/** Told when embeds must be asked again: those showing `path`, or all. */
const changes = createSubscribers<[path?: string]>();
const changed = changes.publish;

export function addEmbedProvider(provider: EmbedProvider): () => void {
  providers.push(provider);
  changed();
  return () => {
    const at = providers.indexOf(provider);
    if (at < 0) return;
    providers.splice(at, 1);
    changed();
  };
}

/** Starts a plugin that declares embeds of a kind and isn't running yet. */
let starter: ((kind: EmbedKind) => void) | null = null;

export function setEmbedStarter(start: ((kind: EmbedKind) => void) | null) {
  starter = start;
}

let ownerOf: (kind: EmbedKind) => string | null = () => null;

export function setEmbedOwners(owner: (kind: EmbedKind) => string | null) {
  ownerOf = owner;
}

/** The provider that draws embeds of `kind`; null leaves them as source,
 *  until a plugin that declares the kind has started. */
export function embedProvider(kind: EmbedKind): EmbedProvider | null {
  const owner = ownerOf(kind);
  const found =
    providers.find(
      (p) => p.kinds.includes(kind) && (!owner || p.owner === owner),
    ) ?? null;
  if (!found) starter?.(kind);
  return found;
}

/** The embeds showing `path` (every one without it) are asked again: a
 *  file was saved, a plugin called refresh(). */
export function refreshEmbeds(path?: string): void {
  changed(path);
}

export const onEmbedsChange = changes.subscribe;
