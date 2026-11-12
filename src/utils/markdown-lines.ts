import { FRONTMATTER } from "./frontmatter";
/** Blockquote and list markers a fence may sit behind, as in `2. ```` or
 *  `> ~~~`; they are stripped before looking for the fence itself. */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)])(?=[ \t]|$)[ \t]?)*[ \t]*/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Each line of `markdown` with whether it is code: inside a fenced block or
 * one of its fences - and, for a whole document (`frontMatter`), in the
 * front matter at its top (YAML, whose `#` starts a comment, not a
 * heading); a fragment's leading `---` lines are its own. As in CommonMark, a fence closes only on a run of the
 * same character at least as long as the one that opened it, with nothing
 * after it - so ``` inside ~~~ stays code.
 */
export function eachLine(
  markdown: string,
  visit: (line: string, index: number, code: boolean) => void,
  /** `$$` blocks count as code too: maths, kept whole. */
  { math = false, frontMatter = false } = {},
): void {
  let fence: string | null = null;
  const head = frontMatter ? (FRONTMATTER.exec(markdown)?.[0] ?? "") : "";
  const yamlLines = head ? head.replace(/\n$/, "").split("\n").length : 0;
  markdown.split("\n").forEach((line, index) => {
    if (index < yamlLines) return visit(line, index, true);
    const bare = line.replace(CONTAINER_PREFIX, "");
    if (math && (fence === "$$" || (!fence && bare.startsWith("$$")))) {
      const rest = bare.trimEnd();
      // Opened, closed on a line ending in $$; `$$x$$` closes itself.
      if (fence) {
        if (rest.endsWith("$$")) fence = null;
      } else if (!(rest.length > 2 && rest.slice(2).endsWith("$$"))) {
        fence = "$$";
      }
      return visit(line, index, true);
    }
    const found = FENCE.exec(bare);
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

/** A heading as the editor reads it: its level, its text, its line. */
interface HeadingLine {
  level: number;
  text: string;
  line: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*(?:[ \t]#+[ \t]*)?$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
// A line that starts a block of its own can't be a setext heading's text.
const NOT_TEXT = /^ {0,3}(?:[-+*>|]|\d+[.)]|#|$)/;

/** A whole document's headings, in order, as the editor counts them: ATX
 *  (indented up to three spaces, empty ones too) and setext (`Title` over
 *  `===` or `---`), outside code and front matter. */
export function headingsOf(markdown: string): HeadingLine[] {
  const out: HeadingLine[] = [];
  let previous: { text: string; index: number } | null = null;
  eachLine(
    markdown,
    (line, index, code) => {
      const before = previous;
      previous = null;
      if (code) return;
      const atx = ATX.exec(line);
      if (atx) {
        out.push({ level: atx[1].length, text: atx[2] ?? "", line: index });
        return;
      }
      const under = SETEXT.exec(line);
      if (under && before && before.index === index - 1) {
        out.push({
          level: under[1][0] === "=" ? 1 : 2,
          text: before.text.trim(),
          line: before.index,
        });
        return;
      }
      if (!NOT_TEXT.test(line)) previous = { text: line, index };
    },
    { frontMatter: true },
  );
  return out;
}
