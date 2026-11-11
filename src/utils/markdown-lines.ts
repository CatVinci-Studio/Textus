/** Blockquote and list markers a fence may sit behind, as in `2. ```` or
 *  `> ~~~`; they are stripped before looking for the fence itself. */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)])(?=[ \t]|$)[ \t]?)*[ \t]*/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Each line of `markdown` with whether it is code: inside a fenced block or
 * one of its fences. As in CommonMark, a fence closes only on a run of the
 * same character at least as long as the one that opened it, with nothing
 * after it - so ``` inside ~~~ stays code.
 */
export function eachLine(
  markdown: string,
  visit: (line: string, index: number, code: boolean) => void,
): void {
  let fence: string | null = null;
  markdown.split("\n").forEach((line, index) => {
    const found = FENCE.exec(line.replace(CONTAINER_PREFIX, ""));
    if (fence) {
      if (
        found &&
        found[1][0] === fence[0] &&
        found[1].length >= fence.length &&
        found[2].trim() === ""
      )
        fence = null;
      return visit(line, index, true);
    }
    // A backtick fence's info string can't hold a backtick: ```a``` is code.
    if (found && !(found[1][0] === "`" && found[2].includes("`"))) {
      fence = found[1];
      return visit(line, index, true);
    }
    visit(line, index, false);
  });
}
