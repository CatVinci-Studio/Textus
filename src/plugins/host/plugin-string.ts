/**
 * A plugin's string `key` from its manifest's `l10n`, for `language`: its
 * own, then its base language's (not "zh" for "zh-Hant", which reads the
 * English), then English, then any
 * language that has it, then the key; "{0}", "{1}"... filled from `args`.
 * Self-contained: the plugin frames are given its source (frames.ts).
 */
export function pluginString(
  l10n: Record<string, Record<string, string> | undefined>,
  language: string,
  key: string,
  args: readonly unknown[] = [],
): string {
  const base =
    language === "zh-Hant" ? language : String(language).split("-")[0];
  let text =
    (l10n[language] && l10n[language][key]) ||
    (l10n[base] && l10n[base][key]) ||
    (l10n.en && l10n.en[key]);
  if (!text)
    for (const other in l10n) {
      const found = l10n[other] && l10n[other][key];
      if (found) {
        text = found;
        break;
      }
    }
  return (text || key).replace(/\{(\d+)\}/g, (all, n: string) =>
    args[Number(n)] === undefined ? all : String(args[Number(n)]),
  );
}
