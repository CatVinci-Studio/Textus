/**
 * What the pointer rests on in the editor (a document link, another link, or
 * a `[@key]` citation), and the plugins with a card for it. The first plugin
 * that answers is shown.
 */

export type HoverTarget =
  | { type: "document"; path: string; heading: string | null }
  | { type: "link"; url: string }
  | { type: "citation"; key: string };

export interface HoverCard {
  title: string | null;
  /** Shown as Markdown, with no pictures. */
  markdown: string;
  /** The app's, never a plugin's: Open on a document's card goes to it. */
  open?: () => void;
}

type Provide = (target: HoverTarget) => Promise<HoverCard | null>;

/** How long a plugin has to answer before the next is asked. */
const ANSWER_MS = 1500;

const providers = new Map<string, Provide>();

export function addHoverProvider(plugin: string, provide: Provide): void {
  providers.set(plugin, provide);
}

export function removeHoverProvider(plugin: string): void {
  providers.delete(plugin);
}

/** Plugins that start on the first hover (`"onHover"`), and what starts them.
 *  A plugin that only shows cards needs to run no sooner. */
let waiting = 0;
let startWaiting: (() => Promise<void>) | null = null;

export function setHoverStarter(
  count: number,
  start: (() => Promise<void>) | null,
): void {
  waiting = count;
  startWaiting = start;
}

export function hasHoverProviders(): boolean {
  return providers.size > 0 || waiting > 0;
}

/** The first card a plugin has for `target`, or null. */
export async function provideHover(
  target: HoverTarget,
): Promise<HoverCard | null> {
  if (waiting > 0 && startWaiting) await startWaiting().catch(() => {});
  for (const provide of [...providers.values()]) {
    const card = await Promise.race([
      provide(target).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ANSWER_MS),
      ),
    ]);
    if (card) return card;
  }
  return null;
}
