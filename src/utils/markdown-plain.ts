/** A line of Markdown as it reads: link and image syntax, code and
 *  emphasis marks dropped, so "`text-spacing`" shows as text-spacing; code
 *  and maths keep their text as written, and snake_case its underscores. */
export function plainInline(text: string): string {
  // Code and maths are set aside first: marks inside them are their text.
  const kept: string[] = [];
  const keep = (s: string) => `\uE000${kept.push(s) - 1}\uE000`;
  return (
    text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`]+)`+/g, (_, code: string) => keep(code))
      .replace(/\$+[^$]+\$+/g, keep)
      .replace(/(\*\*|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
      // Underscores mark emphasis only at a word's edge (snake_case stays).
      .replace(
        /(?<![\p{L}\p{N}_])(__?)(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}_])/gu,
        "$2",
      )
      .replace(/\uE000(\d+)\uE000/g, (_, i: string) => kept[Number(i)])
  );
}
