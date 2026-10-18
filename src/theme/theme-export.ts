import contentBaseCss from "./content-base.css?raw";

// An ornament's selector: this prefix, then what it styles. The heading
// marks (the h3 bar, the h4 dot) carry `:not([data-no-heading-marks])` as
// well - Settings > Editor & Appearance > Heading marks turns them off.
const ORNAMENT_PREFIX =
  /^:root:not\(\[data-user-theme\]\)(:not\(\[data-no-heading-marks\]\))?\s+\.milkdown\s+/;

/**
 * Textus's own ornaments from content-base.css (the h2 rule, the h3 bar, the
 * tinted quote, ...) rewritten as plain `#write` rules. Importing any theme
 * switches those ornaments off, so an exported theme has to carry them
 * itself or it loses them on the way back in (#29) - and as real rules the
 * user can edit or delete each one. With `headingMarks` off the h3 bar and
 * h4 dot are left out, as they are on screen (#136). `css` is for tests.
 */
export function ornamentRules({
  headingMarks = true,
  css = contentBaseCss,
}: { headingMarks?: boolean; css?: string } = {}): string {
  const rules: string[] = [];
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const prefix = ORNAMENT_PREFIX.exec(selector);
    if (!prefix) continue;
    if (prefix[1] && !headingMarks) continue;
    const declarations = match[2]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `  ${line};`)
      .join("\n");
    rules.push(
      `#write ${selector.slice(prefix[0].length)} {\n${declarations}\n}`,
    );
  }
  return rules.join("\n\n");
}
