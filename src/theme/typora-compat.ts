// Typora themes target Typora's DOM, which mostly lines up through `#write`.
// Where it doesn't, the theme's selectors are rewritten onto ours.

/** Typora's CodeMirror token classes as the Prism classes refractor emits. */
const CODE_TOKENS = new Map<string, string[]>(
  Object.entries({
    keyword: ["keyword"],
    atom: ["boolean", "constant"],
    number: ["number"],
    def: ["function"],
    variable: ["variable"],
    "variable-2": ["parameter"],
    "variable-3": ["class-name"],
    type: ["class-name"],
    property: ["property"],
    operator: ["operator"],
    comment: ["comment", "prolog", "doctype"],
    string: ["string", "char", "attr-value"],
    "string-2": ["regex"],
    meta: ["annotation", "decorator", "directive", "macro"],
    qualifier: ["selector"],
    builtin: ["builtin"],
    bracket: ["punctuation"],
    tag: ["tag"],
    attribute: ["attr-name"],
    header: ["title"],
    quote: ["blockquote"],
    hr: ["hr"],
    link: ["url"],
    positive: ["inserted"],
    negative: ["deleted"],
    strong: ["bold"],
    em: ["italic"],
  }),
);

const tokenSelector = (classes: string[]) =>
  classes.length === 1
    ? `.token.${classes[0]}`
    : `.token:is(${classes.map((c) => `.${c}`).join(", ")})`;

// Typora's code box is a CodeMirror inside `pre.md-fences`; ours is the
// <pre> inside the `.md-fences` wrapper. Weightless, so the editor's own
// rule against margins inside the wrapper still holds.
const CODE_BOX = ":where(.md-fences pre)";
const END = "(?![\\w-])";

const SELECTORS: [RegExp, string][] = [
  // Milkdown has no <thead>: the header row is a `tr[data-is-header]`.
  [/\bthead\b(?:\s*>?\s*tr\b)?/g, "tr[data-is-header]"],
  [new RegExp(`\\bpre\\.md-fences${END}`, "g"), ".md-fences"],
  [new RegExp(`\\.(?:cm-s-inner|CodeMirror)${END}`, "g"), CODE_BOX],
  [
    new RegExp(`\\.(?:md-)?task-list-item${END}`, "g"),
    '[data-item-type="task"]',
  ],
  [new RegExp(`\\.task-list-done${END}`, "g"), '[data-checked="true"]'],
  [new RegExp(`\\.task-list-not-done${END}`, "g"), '[data-checked="false"]'],
  [new RegExp(`(?:\\bpre)?\\.md-meta-block${END}`, "g"), ".frontmatter-block"],
  [new RegExp(`\\.md-image${END}`, "g"), ".image-view"],
];
const CODE_TOKEN = new RegExp(`\\.cm-([a-z]+(?:-\\d)?)${END}`, "g");

// What Typora's own stylesheet does with a theme's variables, added only for
// the ones the theme sets: without them these would have no value at all.
const TYPORA_BASE: [string, string][] = [
  ["--monospace", "#write { --font-mono: var(--monospace); }"],
  [
    "--select-text-bg-color",
    "#write ::selection { background-color: var(--select-text-bg-color); }",
  ],
  [
    "--select-text-font-color",
    "#write ::selection { color: var(--select-text-font-color); }",
  ],
];

/** Rewrites an imported Typora theme's selectors onto Textus's editor DOM. */
export function adaptTyporaCss(css: string): string {
  let out = css;
  for (const [pattern, replacement] of SELECTORS)
    out = out.replace(pattern, replacement);
  out = out.replace(CODE_TOKEN, (match, name: string) => {
    const classes = CODE_TOKENS.get(name);
    return classes ? tokenSelector(classes) : match;
  });
  const base = TYPORA_BASE.filter(([variable]) =>
    new RegExp(`(?<![\\w-])${variable}\\s*:`).test(css),
  ).map(([, rule]) => rule);
  return base.length ? `${out}\n${base.join("\n")}\n` : out;
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
