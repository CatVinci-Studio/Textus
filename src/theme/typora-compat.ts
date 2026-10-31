// Typora themes target Typora's DOM, which mostly lines up through `#write`.
// The gap is the table header: Milkdown puts it in `<tbody>` with no `<thead>`,
// so `thead th` rules would never match.
const THEAD_SELECTOR = /\bthead\b(?:\s*>?\s*tr\b)?/g;

/** Rewrites an imported Typora theme's selectors onto Textus's editor DOM. */
export function adaptTyporaCss(css: string): string {
  return css.replace(THEAD_SELECTOR, "tr[data-is-header]");
}

// iOS 26 WebKit stops at the generic system families, drawing CJK as
// missing-glyph boxes; named, each face falls back as any font does. A
// theme written for macOS names them, so on iOS they become the faces.
const SYSTEM_FAMILIES = new Map([
  ["-apple-system", '"SF Pro Text"'],
  ["system-ui", '"SF Pro Text"'],
  ["ui-sans-serif", '"SF Pro Text"'],
  ["ui-serif", '"New York"'],
  ["ui-monospace", '"SF Mono"'],
  ["ui-rounded", '"SF Pro Rounded"'],
]);
const SYSTEM_FAMILY =
  /(?<=[\s,:])(-apple-system|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)(?=\s*[,;}!]|\s*$)/gm;

/** A theme's generic system font families as the faces they stand for. */
export function namedSystemFonts(css: string): string {
  return css.replace(SYSTEM_FAMILY, (name) => SYSTEM_FAMILIES.get(name)!);
}
