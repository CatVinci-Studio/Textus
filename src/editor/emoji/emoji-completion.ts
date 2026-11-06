import { addCompletionSource, type PanelItem } from "../completion/sources";
import { emojiNames } from "./emoji-shortcode-plugin";

/** `:sm` lists the emoji by name; taking one writes its `:name:`, which
 *  the file keeps and the editor draws. */

let items: PanelItem[] | null = null;
let title = () => "Emoji";
let added = false;

function emojiItems(names: Record<string, string>): PanelItem[] {
  return (items ??= Object.entries(names).map(([name, emoji]) => ({
    label: name,
    insert: `:${name}:`,
    icon: emoji,
  })));
}

/** The core's emoji source, its heading in the window's language. */
export function addEmojiCompletion(heading: () => string): void {
  title = heading;
  if (added) return;
  added = true;
  addCompletionSource({
    id: "textus.emoji",
    owner: "core",
    where: "text",
    // Left to a plugin listing emoji itself (Quick Insert).
    fallback: true,
    pattern: /(?:^|[\s(])(:([a-z0-9_+-]{2,}))$/,
    replaceGroup: 1,
    title: () => title(),
    provide: () => {
      const names = emojiNames.peek();
      if (names) return { items: emojiItems(names), complete: true };
      return emojiNames.load().then(
        (loaded) => ({ items: emojiItems(loaded), complete: true as const }),
        () => null,
      );
    },
  });
}
