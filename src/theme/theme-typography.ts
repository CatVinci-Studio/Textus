/** What the theme workshop adjusts. A font of "" and a measure of null
 *  follow the starting theme: nothing is written for them. */
export interface TypeChoices {
  bodyFont: string;
  headingFont: string;
  codeFont: string;
  /** px */
  fontSize: number | null;
  /** h3 to body; h2 is its square, h1 its cube, h4 its root. */
  headingRatio: number | null;
  lineHeight: number | null;
  /** The text column, px. */
  width: number | null;
  /** Between paragraphs, em. */
  paragraphGap: number | null;
  /** em */
  indent: number | null;
  /** A page palette's id (workshop-palettes.ts), "" for the theme's. */
  palette: string;
  /** A code palette's id, "" for the theme's. */
  syntax: string;
}

export type TypeFont = "bodyFont" | "headingFont" | "codeFont";
export type TypeMeasure = Exclude<
  keyof TypeChoices,
  TypeFont | "palette" | "syntax"
>;

export const typeFonts = (choices: TypeChoices): string[] => [
  choices.bodyFont,
  choices.headingFont,
  choices.codeFont,
];

export const NO_CHOICES: TypeChoices = {
  bodyFont: "",
  headingFont: "",
  codeFont: "",
  fontSize: null,
  headingRatio: null,
  lineHeight: null,
  width: null,
  paragraphGap: null,
  indent: null,
  palette: "",
  syntax: "",
};

/** Each measure's slider, in the order the workshop lists them. */
export const TYPE_RANGES: Record<
  TypeMeasure,
  { min: number; max: number; step: number }
> = {
  fontSize: { min: 12, max: 26, step: 0.5 },
  headingRatio: { min: 1, max: 1.6, step: 0.02 },
  lineHeight: { min: 1.2, max: 2.4, step: 0.05 },
  width: { min: 480, max: 1200, step: 20 },
  paragraphGap: { min: 0, max: 2, step: 0.1 },
  indent: { min: 0, max: 4, step: 0.5 },
};

/** The starting theme's own faces as the page resolves them: what a chosen
 *  face falls back to for the characters it lacks (CJK, for a Latin face). */
export interface FontStacks {
  body: string;
  heading: string;
  code: string;
}

const FALLBACK_STACKS: FontStacks = {
  body: "var(--font-sans)",
  heading: "var(--font-sans)",
  code: "var(--font-mono)",
};

const round = (n: number, places = 3) => Number(n.toFixed(places));

export const rule = (selector: string, lines: string[]) =>
  lines.length
    ? `${selector} {\n${lines.map((l) => `  ${l};`).join("\n")}\n}`
    : "";

const face = (name: string, stack: string) =>
  `${JSON.stringify(name)}, ${stack}`;

/**
 * The rules a workshop theme adds over its starting theme: the variables
 * Textus reads (`--doc-font`, `--doc-mono-font`, `--doc-font-size`,
 * `--doc-line-height`) and the `#write` rules a Typora theme needs, only for
 * what was changed. The reader's own size, leading and width in Settings
 * still win: they are set on the root over any theme.
 */
export function typographyCss(
  choices: TypeChoices,
  stacks: FontStacks = FALLBACK_STACKS,
): string {
  const vars: string[] = [];
  const write: string[] = [];
  const rules: string[] = [];
  if (choices.bodyFont) {
    vars.push(`--doc-font: ${face(choices.bodyFont, stacks.body)}`);
    write.push("font-family: var(--doc-font)");
  }
  if (choices.fontSize !== null) {
    vars.push(`--doc-font-size: ${round(choices.fontSize, 1)}px`);
    write.push("font-size: var(--doc-font-size)");
  }
  if (choices.lineHeight !== null) {
    vars.push(`--doc-line-height: ${round(choices.lineHeight, 2)}`);
    write.push("line-height: var(--doc-line-height)");
  }
  if (choices.width !== null) write.push(`max-width: ${choices.width}px`);
  if (choices.paragraphGap !== null) {
    const gap = `${round(choices.paragraphGap, 2)}em`;
    write.push(`--doc-gap: ${gap}`);
    rules.push(
      rule("#write > p", [`margin-top: ${gap}`, `margin-bottom: ${gap}`]),
      rule("#write > p:first-child", ["margin-top: 0"]),
    );
  }
  if (choices.indent !== null)
    rules.push(
      rule("#write > p:not(.image-paragraph)", [
        `text-indent: ${round(choices.indent, 2)}em`,
      ]),
    );
  if (choices.headingFont)
    rules.push(
      rule("#write :is(h1, h2, h3, h4, h5, h6)", [
        `font-family: ${face(choices.headingFont, stacks.heading)}`,
      ]),
    );
  if (choices.headingRatio !== null) {
    const r = choices.headingRatio;
    const sizes: [string, number][] = [
      ["h1", r ** 3],
      ["h2", r ** 2],
      ["h3", r],
      ["h4", Math.sqrt(r)],
    ];
    for (const [tag, size] of sizes)
      rules.push(rule(`#write ${tag}`, [`font-size: ${round(size)}em`]));
  }
  if (choices.codeFont) {
    vars.push(`--doc-mono-font: ${face(choices.codeFont, stacks.code)}`);
    rules.push(
      rule("#write :is(code, pre)", ["font-family: var(--doc-mono-font)"]),
    );
  }
  return [rule(":root", vars), rule("#write", write), ...rules]
    .filter(Boolean)
    .join("\n\n");
}
