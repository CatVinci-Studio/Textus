// The order file names are listed in - the sidebar's tree and its search
// results: the way a file manager sorts them in the interface's language.
// Numbers by value ("file2" before "file10", "第2章" before "第10章"), case
// and accents ignored, and Chinese by the language's own collation (pinyin
// for Simplified Chinese, stroke order for Traditional). Names written with
// Chinese numerals (第一章, 第十章) follow that collation, not 1-2-3: a
// hand-written numeral parser would be one more order nobody else uses.

const collators = new Map<string, Intl.Collator>();

/** The collator for a BCP 47 locale ("zh-CN", "en"), made once. */
export function nameCollator(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    collators.set(locale, collator);
  }
  return collator;
}

/** Folders first, then by name; equal names (case only) by code point, so
 *  the order never depends on which came first. */
export function compareEntries(
  collator: Intl.Collator,
  a: { name: string; is_dir: boolean },
  b: { name: string; is_dir: boolean },
): number {
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return (
    collator.compare(a.name, b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}
