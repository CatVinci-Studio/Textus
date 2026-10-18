import contentBaseCss from "./content-base.css?raw";

const ORNAMENT_PREFIX = ":root:not([data-user-theme]) .milkdown ";

/**
 * Textus's own ornaments from content-base.css (the h2 rule, the h3 bar, the
 * tinted quote, ...) rewritten as plain `#write` rules. Importing any theme
 * switches those ornaments off, so an exported theme has to carry them
 * itself or it loses them on the way back in (#29) - and as real rules the
 * user can edit or delete each one.
 */
export function ornamentRules(css: string = contentBaseCss): string {
  const rules: string[] = [];
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!selector.startsWith(ORNAMENT_PREFIX)) continue;
    const declarations = match[2]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `  ${line};`)
      .join("\n");
    rules.push(
      `#write ${selector.slice(ORNAMENT_PREFIX.length)} {\n${declarations}\n}`,
    );
  }
  return rules.join("\n\n");
}
