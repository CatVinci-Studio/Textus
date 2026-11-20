/** The kinds of Markdown the editor step asks the learner to type. */
const FORMATS = ["heading", "list", "numbered", "task"] as const;
export type Format = (typeof FORMATS)[number];

const SEEN: Record<Format, RegExp> = {
  heading: /^#{1,6}[ \t]+\S/,
  list: /^[ \t]*[-*+][ \t]+(?!\[[ xX]\])\S/,
  numbered: /^[ \t]*\d+[.)][ \t]+\S/,
  task: /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+\S/,
};

/** Which of the kinds the learner's text has, formatted as typed. */
export function formatsIn(markdown: string): Format[] {
  const lines = markdown.split("\n");
  return FORMATS.filter((kind) => lines.some((line) => SEEN[kind].test(line)));
}
