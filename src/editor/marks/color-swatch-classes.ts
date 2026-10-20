// The swatch's class names, apart from color-swatch-plugin.ts: the export
// (export/exporters.ts, in the entry chunk) needs only these, and importing
// the plugin would bring refractor, through code-comments.ts, into the
// entry instead of the lazily loaded editor chunk.

/** The swatch's element in inline code, editor chrome the export and print
 *  drop. */
export const COLOR_SWATCH_CLASS = "color-swatch";
/** The first character of a colour code in plain text or a code block,
 *  which draws the swatch before itself (::before); the export unwraps
 *  it. */
export const COLOR_SWATCH_TEXT_CLASS = "color-swatch-text";
