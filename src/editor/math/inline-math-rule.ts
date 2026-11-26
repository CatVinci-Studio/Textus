// Which `$` opens inline math within a line, as patterns for the chat
// renderer and the Pandoc export. The editor's micromark tokenizers
// (dollar-math-syntax, backtick-math-syntax) read by the same rule;
// inline-math-rule.test.ts holds all three to one table.

/** Not after an odd run of backslashes: a `\$` is a dollar sign. */
export const UNESCAPED = String.raw`(?<=(?:^|[^\\])(?:\\\\)*)`;

/** GitHub's $`x`$: anything but a backtick or a line ending inside. */
export const BACKTICK_MATH = String.raw`\$` + "`([^`\\n]+)`" + String.raw`\$`;

/** Pandoc's $x$: no space just inside either dollar, no digit after the
 *  closing one, and not opened before a backtick. */
export const DOLLAR_MATH =
  String.raw`\$(?![\s` + "`" + String.raw`])([^$\n]+?)(?<!\s)\$(?!\d)`;
