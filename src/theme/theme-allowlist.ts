/// What a theme from an AI reply may contain, checked on the webview's own
/// CSS parser rather than on the text: a positive list of selectors and
/// properties (docs/design/design-language.md, section 14.1, and the theme
/// skill's rules), so CSS the list doesn't know is dropped instead of having to
/// be foreseen. The same engine applies the theme later, so what was checked is
/// what runs, and the saved file is the checked rules written out again.

/** `:root`, `html` or `body`, with attribute qualifiers
 *  (`:root[data-theme="dark"]`). */
const ROOT = String.raw`(?::root|html|body)(?:\[[^\]]*\])*`;
const ROOT_SELECTOR = new RegExp(`^${ROOT}$`);
/** A selector inside the document: optional root compounds, then `#write`
 *  or `.milkdown` with its own qualifiers, then nothing or a descendant or
 *  child combinator. A sibling combinator after it (`#write ~ .panel`) would
 *  reach the app around the page, so it doesn't match. */
const DOCUMENT_SELECTOR = new RegExp(
  String.raw`^(?:${ROOT}\s*>?\s*)*(?:#write|\.milkdown)(?![\w-])` +
    String.raw`(?:[.#][\w-]+|\[[^\]]*\]|::?[a-z-]+(?:\([^()]*\))?)*` +
    String.raw`(?:$|\s*>\s*\S|\s+[^\s~+>])`,
);

/** The variables a theme may set: the document's, the interface colours
 *  derived from them, the tones and revision colours. Sizes, spacing, radii and
 *  motion tokens are the app's (section 14.1). */
const VARIABLE = /^--(?:doc|ui|tone|revision)-/;

/** What `:root`, `html` and `body` rules may set besides variables. */
const ROOT_PROPERTY = /^(?:color|color-scheme|background-color)$/;

/** What rules inside the document may set: colour and typography, borders,
 *  and the spacing of its own blocks. Not `display`, `position`, `content`,
 *  `transform`, `pointer-events`, `user-select`, `caret-color`, `white-space`,
 *  `counter-*`, `list-style-*`, sizes or motion: those change how the editor works or what
 *  it shows, not how the text looks. Shorthands are listed with their
 *  longhands: a parser may keep either. */
const DOCUMENT_PROPERTY = new RegExp(
  "^(?:" +
    [
      "color|color-scheme|accent-color",
      "background(?:-(?:color|image|position(?:-[xy])?|repeat(?:-[xy])?|size|clip|origin|attachment))?",
      "border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:width|style|color))?",
      "border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius",
      "border-image(?:-[a-z]+)?",
      "border-(?:collapse|spacing)|-webkit-border-(?:horizontal|vertical)-spacing",
      "outline(?:-(?:width|style|color|offset))?",
      "(?:box|text)-shadow",
      "font(?:-[a-z]+)*",
      "line-height|letter-spacing|word-spacing|word-break|overflow-wrap|hyphens|tab-size",
      "text-(?:align|indent|transform|wrap|underline-offset|underline-position)",
      "text-decoration(?:-[a-z]+)*|text-emphasis(?:-[a-z]+)*",
      "quotes|vertical-align",
      "(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?",
    ].join("|") +
    ")$",
);

type Scope = "root" | "document";

/** A selector list's top-level parts: commas inside `:is(a, b)` don't split. */
function selectorParts(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(selectorText.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selectorText.slice(start).trim());
  return parts;
}

/** Where a rule's selectors all point: the root (variables only, mostly), the
 *  document, or somewhere a theme doesn't style (null). A list that mixes root
 *  and document gets the root's narrower set. */
function scopeOf(selectorText: string): Scope | null {
  let scope: Scope = "document";
  for (const part of selectorParts(selectorText)) {
    if (ROOT_SELECTOR.test(part)) scope = "root";
    else if (!DOCUMENT_SELECTOR.test(part)) return null;
  }
  return scope;
}

function allowed(name: string, scope: Scope): boolean {
  if (name.startsWith("--")) return VARIABLE.test(name);
  return scope === "root"
    ? ROOT_PROPERTY.test(name)
    : DOCUMENT_PROPERTY.test(name);
}

/** The style rule with only the properties its scope allows, or null when
 *  nothing it may set is left. Iterating a declaration lists longhands, so
 *  a shorthand (`border`, `font`) is judged by the parts it sets. */
function keepStyleRule(rule: CSSStyleRule): boolean {
  const scope = scopeOf(rule.selectorText);
  if (!scope) return false;
  // Nested rules (`& + .panel`) could leave the document; a theme needs none.
  const nesting = rule as Partial<GroupingRule>;
  if (nesting.cssRules?.length) {
    if (typeof nesting.deleteRule !== "function") return false;
    for (let i = nesting.cssRules.length - 1; i >= 0; i--)
      nesting.deleteRule(i);
  }
  const { style } = rule;
  for (const name of Array.from(style))
    if (!allowed(name, scope)) style.removeProperty(name);
  return style.length > 0;
}

interface GroupingRule {
  cssRules: CSSRuleList;
  deleteRule(index: number): void;
}

/** Whether `rule` is an instance of the global `name`, which a webview (or
 *  jsdom) may not define. */
function isA(rule: CSSRule, name: "CSSMediaRule" | "CSSSupportsRule"): boolean {
  const ctor = (globalThis as Record<string, unknown>)[name];
  return typeof ctor === "function" && rule instanceof ctor;
}

/** Drops every rule (in place) a theme may not have; `@media` and
 *  `@supports` keep their allowed rules. */
function filterRules(owner: GroupingRule): void {
  const { cssRules } = owner;
  for (let i = cssRules.length - 1; i >= 0; i--) {
    const rule = cssRules[i];
    let keep = false;
    if (rule instanceof CSSStyleRule) keep = keepStyleRule(rule);
    else if (isA(rule, "CSSMediaRule") || isA(rule, "CSSSupportsRule")) {
      const group = rule as unknown as GroupingRule;
      filterRules(group);
      keep = group.cssRules.length > 0;
    }
    if (!keep) owner.deleteRule(i);
  }
}

/** The stylesheet as the webview parses it: a constructed sheet, or, in a
 *  webview without them, a `<style>` in a document that loads nothing. */
function parse(css: string): CSSStyleSheet | null {
  try {
    if (
      typeof CSSStyleSheet === "function" &&
      "replaceSync" in CSSStyleSheet.prototype
    ) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet;
    }
    if (typeof document === "undefined") return null;
    const inert = document.implementation.createHTMLDocument("");
    const style = inert.createElement("style");
    style.textContent = css;
    inert.head.append(style);
    return style.sheet;
  } catch {
    return null;
  }
}

/** The leading comment, which names the theme (`/* Name - ... *\/`). */
const LEADING_COMMENT = /^\s*(\/\*[\s\S]*?\*\/)/;

/**
 * `css` with only what a theme may contain: style rules for `:root`, `html`,
 * `body` and the document (`#write`, `.milkdown`), inside `@media` or
 * `@supports` if need be, each with only the properties on the list. Every
 * other at-rule, selector and property is dropped. Null when there is no CSS
 * parser (a theme is not offered unchecked) or nothing is left.
 */
export function allowedThemeCss(css: string): string | null {
  const sheet = parse(css);
  if (!sheet) return null;
  filterRules(sheet);
  if (sheet.cssRules.length === 0) return null;
  const rules = Array.from(sheet.cssRules, (rule) => rule.cssText);
  const comment = LEADING_COMMENT.exec(css)?.[1];
  return [...(comment ? [comment] : []), ...rules].join("\n\n") + "\n";
}
