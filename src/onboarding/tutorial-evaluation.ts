/** Whether the learner's text has any Markdown formatted as typed: a
 *  heading, a list, a numbered list or a task. */
export function hasFormatting(markdown: string): boolean {
  return markdown
    .split("\n")
    .some(
      (line) =>
        /^#{1,6}[ \t]+\S/.test(line) ||
        /^[ \t]*([-*+]|\d+[.)])[ \t]+\S/.test(line),
    );
}
