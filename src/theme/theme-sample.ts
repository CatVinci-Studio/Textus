// What an installed theme looks like, read from its CSS text without ever
// applying it: the four values a card's sample draws. A theme's stylesheet
// is only scanned here, never injected, so it can't restyle the settings
// page around the card.

/** The values a theme sets; a missing one stays null and the card keeps the
 *  current look's. */
export interface ThemeSample {
  bg: string | null;
  text: string | null;
  accent: string | null;
  /** A font-family list, the heading's. */
  font: string | null;
}

interface Rule {
  selector: string;
  body: string;
  context: string;
}

/** Block starts that carry no look of their own. */
const SKIPPED_AT = /^@(font-face|keyframes|-webkit-keyframes|page|property)/;

/** The style rules of `css` in source order, each with the at-rules it sits
 *  in (`@media ...`), nested media flattened. */
function rulesOf(css: string, context = ""): Rule[] {
  const out: Rule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    // A statement like `@import ...;` before the block is not its prelude.
    const prelude = css.slice(at, open).split(";").pop()!.trim();
    const body = css.slice(open + 1, end - 1);
    at = end;
    if (SKIPPED_AT.test(prelude)) continue;
    if (prelude.startsWith("@"))
      out.push(...rulesOf(body, `${context} ${prelude}`));
    else out.push({ selector: prelude, body, context });
  }
  return out;
}

const DARK_MARK =
  /prefers-color-scheme:\s*dark|data-theme\s*=\s*["']?dark|\.(?:theme-)?dark\b/i;
const LIGHT_MARK =
  /prefers-color-scheme:\s*light|(?<!:not\()\[data-theme\s*=\s*["']?light/i;

/** Whether the rule holds in the appearance asked for. */
function applies(rule: Rule, dark: boolean): boolean {
  const where = `${rule.context} ${rule.selector}`;
  if (DARK_MARK.test(where)) return dark;
  if (LIGHT_MARK.test(where)) return !dark;
  return true;
}

function declarations(body: string): [string, string][] {
  return body
    .split(";")
    .map((d) => {
      const colon = d.indexOf(":");
      return colon < 0
        ? null
        : ([
            d.slice(0, colon).trim().toLowerCase(),
            d
              .slice(colon + 1)
              .replace(/!important/i, "")
              .trim(),
          ] as [string, string]);
    })
    .filter((d): d is [string, string] => !!d && !!d[0] && !!d[1]);
}

const MAX_DEPTH = 4;

/** `var(--x, fallback)` replaced by what the theme gives `--x`; null when
 *  something stays unresolved. */
function resolve(
  value: string,
  vars: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  if (!value.includes("var(")) return value;
  if (depth >= MAX_DEPTH) return null;
  let failed = false;
  const out = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (_, name: string, fallback?: string) => {
      const found = vars.get(name) ?? fallback?.trim();
      if (found === undefined) failed = true;
      return found ?? "";
    },
  );
  return failed ? null : resolve(out, vars, depth + 1);
}

// Only plain colour and font values go into the card's style: a hex, a
// colour function, a name, a font list - never a url, a nested rule or a
// leftover variable.
const COLOR =
  /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([\w\s.,%/+-]*(?:\([\w\s.,%/+-]*\)[\w\s.,%/+-]*)*\)|[a-z]{3,30})$/i;
const NOT_A_COLOR =
  /^(?:inherit|initial|unset|revert|transparent|none|auto|currentcolor)$/i;
const FONT = /^[\w\s,"'.-]+$/;

const color = (value: string | null) =>
  value && COLOR.test(value) && !NOT_A_COLOR.test(value) ? value : null;
const font = (value: string | null) =>
  value && FONT.test(value) && !/^(inherit|initial|unset)$/i.test(value)
    ? value
    : null;

/** A `background` shorthand that is just a colour, else null. */
function backgroundColor(value: string): string | null {
  return color(value.includes(" ") ? null : value);
}

// A rule is about the page, a heading or a link when its selector's last
// part is: `#write h1` styles the heading, not the page.
const PAGE =
  /(?:^|[\s>])(?::root|html|body|#write|\.milkdown|\.prosemirror)\s*$/i;
const VARS =
  /(?:^|[\s,>])(?::root|html|body|#write|\*)(?=$|[\s,>.:[{])|data-(?:content|user)-theme/i;
const HEADING = /(?:^|[\s>])h1\s*$/i;
const LINK = /(?:^|[\s>])a\s*$/i;

/** The page colours, accent and heading font a theme's CSS sets in the given
 *  appearance: its `--doc-*` variables first, then the Typora rules
 *  (`#write`, `body`, `h1`, `a`) and variables (`--bg-color`, `--text-color`,
 *  `--primary-color`) the loader already understands. Later rules win, as
 *  in the cascade; specificity is not weighed. */
export function themeSample(css: string, dark: boolean): ThemeSample {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = new Map<string, string>();
  const seen: Record<
    "bg" | "text" | "font" | "headFont" | "link",
    string | null
  > = { bg: null, text: null, font: null, headFont: null, link: null };
  for (const rule of rulesOf(clean)) {
    if (!applies(rule, dark)) continue;
    const decls = declarations(rule.body);
    for (const [name, value] of decls)
      if (name.startsWith("--") && VARS.test(rule.selector))
        vars.set(name, value);
    for (const selector of rule.selector.split(",").map((x) => x.trim())) {
      const page = PAGE.test(selector);
      for (const [name, value] of decls) {
        if (page && (name === "background" || name === "background-color"))
          seen.bg = value;
        if (page && name === "color") seen.text = value;
        if (page && name === "font-family") seen.font = value;
        if (HEADING.test(selector) && name === "font-family")
          seen.headFont = value;
        if (LINK.test(selector) && name === "color") seen.link = value;
      }
    }
  }
  const get = (value: string | null | undefined) =>
    value ? resolve(value, vars) : null;
  const bg = (v: string | null) => {
    const r = get(v);
    return r && (backgroundColor(r) ?? null);
  };
  return {
    bg:
      color(get(vars.get("--doc-bg"))) ??
      bg(seen.bg) ??
      color(get(vars.get("--bg-color"))),
    text:
      color(get(vars.get("--doc-text"))) ??
      color(get(seen.text)) ??
      color(get(vars.get("--text-color"))),
    accent:
      color(get(vars.get("--doc-accent"))) ??
      color(get(seen.link)) ??
      color(get(vars.get("--primary-color"))),
    font:
      font(get(seen.headFont)) ??
      font(get(vars.get("--doc-font"))) ??
      font(get(seen.font)),
  };
}
