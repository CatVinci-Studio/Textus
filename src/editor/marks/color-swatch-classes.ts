// Kept apart from the plugin: the export needs only these names, and the
// plugin would pull refractor into the entry chunk.

/** The swatch's element in inline code, chrome the export and print drop. */
export const COLOR_SWATCH_CLASS = "color-swatch";
/** The first character of a colour code in text, which draws the swatch
 *  before itself; the export unwraps it. */
export const COLOR_SWATCH_TEXT_CLASS = "color-swatch-text";
