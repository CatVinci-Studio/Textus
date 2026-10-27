/** The leading spaces/tabs of the last line in `textBeforeCursor`: what
 *  Enter in a code block carries onto the new line. */
export function leadingWhitespaceOfLastLine(textBeforeCursor: string): string {
  const lastNewline = textBeforeCursor.lastIndexOf("\n");
  const lastLine = textBeforeCursor.slice(lastNewline + 1);
  return lastLine.match(/^[ \t]*/)?.[0] ?? "";
}
