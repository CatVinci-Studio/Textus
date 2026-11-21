import contentBaseCss from "./content-base.css?raw";

const ORNAMENT_PREFIX = ":root:not([data-user-theme]) .milkdown ";

/** A stylesheet's innermost rules, comments dropped: each selector with its
 *  declarations. At-rule wrappers (`@layer`, `@media`) are looked through. */
export function cssBlocks(
  css: string,
): { selector: string; declarations: string[] }[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean),
  }));
}

/** Textus's own ornaments rewritten as plain `#write` rules. Importing any
 *  theme switches those ornaments off, so an exported theme must carry them. */
export function ornamentRules(css: string = contentBaseCss): string {
  return cssBlocks(css)
    .filter(({ selector }) => selector.startsWith(ORNAMENT_PREFIX))
    .map(
      ({ selector, declarations }) =>
        `#write ${selector.slice(ORNAMENT_PREFIX.length)} {\n${declarations
          .map((line) => `  ${line};`)
          .join("\n")}\n}`,
    )
    .join("\n\n");
}
