import contentBaseCss from "./content-base.css?raw";

const ORNAMENT_PREFIX = ":root:not([data-user-theme]) .milkdown ";

/** Textus's own ornaments rewritten as plain `#write` rules. Importing any
 *  theme switches those ornaments off, so an exported theme must carry them. */
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
