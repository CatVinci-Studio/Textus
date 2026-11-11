/**
 * The document's default colours (base.css's --doc-*), for code that draws
 * where no stylesheet reaches - an exported chart, a theme preview frame -
 * as the fallback of `var(--doc-…, value)`. doc-defaults.test.ts holds them
 * to base.css.
 */
export const DOC_DEFAULTS = {
  light: {
    bg: "#ffffff",
    text: "#1d1d1f",
    muted: "#6e6e73",
    accent: "#007aff",
    border: "#d2d2d7",
  },
  dark: {
    bg: "#1c1c1e",
    text: "#f5f5f7",
    muted: "#98989d",
    accent: "#0a84ff",
    border: "#38383a",
  },
} as const;

type DocColour = keyof (typeof DOC_DEFAULTS)["light"];

/** `var(--doc-<name>)` with its default for `dark` or light behind it. */
export function docVar(name: DocColour, dark = false): string {
  return `var(--doc-${name}, ${DOC_DEFAULTS[dark ? "dark" : "light"][name]})`;
}
