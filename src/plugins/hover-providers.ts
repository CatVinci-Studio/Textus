/**
 * What the pointer rests on in the editor, and the plugins that have a
 * card for it (textus.editor.registerHoverProvider): a link to a document
 * (a Markdown link or a wikilink, found where it points), any other link,
 * or a citation, `[@key]`. The editor asks (editor/hover/); the first
 * plugin with an answer is shown.
 */

export type HoverTarget =
  | { type: "document"; path: string; heading: string | null }
  | { type: "link"; url: string }
  | { type: "citation"; key: string };

export interface HoverCard {
  title: string | null;
  /** Shown as Markdown, with no pictures. */
  markdown: string;
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

export function hasHoverProviders(): boolean {
  return providers.size > 0;
}

/** The first card a plugin has for `target`, or null. */
export async function provideHover(
  target: HoverTarget,
): Promise<HoverCard | null> {
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
