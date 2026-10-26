// Typora themes target Typora's DOM, which mostly lines up through `#write`.
// The gap is the table header: Milkdown puts it in `<tbody>` with no `<thead>`,
// so `thead th` rules would never match.
const THEAD_SELECTOR = /\bthead\b(?:\s*>?\s*tr\b)?/g;

/** Rewrites an imported Typora theme's selectors onto Textus's editor DOM. */
export function adaptTyporaCss(css: string): string {
  return css.replace(THEAD_SELECTOR, "tr[data-is-header]");
}
