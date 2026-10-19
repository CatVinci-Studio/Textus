// LaTeX's own math delimiters, `\(...\)` (inline) and `\[...\]` (display),
// read as math the way remark-math reads `$...$`, with the delimiter kept so
// a save writes it back. Most AI tools write maths this way. Files used to be
// rewritten to `$` on load instead, which changed every formula in them on
// the first save.
import type {
  Code,
  Effects,
  Extension,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
} from "mdast-util-from-markdown";

/** The mdast shapes this file reads and makes (remark-math's own types
 *  live in a package Textus doesn't depend on directly). */
interface MdastNode {
  type: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: MdastNode[];
  position?: unknown;
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    latexMath: "latexMath";
    latexMathChunk: "latexMathChunk";
  }
}

const BACKSLASH = 92;
const GRAVE = 96;
const CLOSER: Record<number, number> = { 40: 41, 91: 93 }; // ( ) and [ ]

/** CR, LF and CRLF are -5, -4 and -3 in micromark. */
const isLineEnding = (code: Code) => code !== null && code < -2;

/** A code that can sit in a bracketed citation, `\[1\]`, `\[2, 3\]`,
 *  `\[4-6\]`: digits, commas, hyphens and whitespace (negative codes are
 *  tabs, virtual spaces and line endings). */
function isCitationCode(code: number): boolean {
  return (
    code < 0 ||
    code === 32 ||
    code === 44 ||
    code === 45 ||
    (code >= 48 && code <= 57)
  );
}

/**
 * micromark syntax: `\(...\)` and `\[...\]` in text. Text is one block's
 * content, so a formula never spans a blank line or two paragraphs, and
 * code - fenced, indented or inline - is never text, so a `\(` in code stays
 * as it is. A formula also stops at a backtick: `\( a ` b \)` leaves the
 * code span alone. A pair holding only a citation's characters is an
 * escaped bracket, `\[1\]`, not math.
 *
 * Registered on the backslash ahead of character escapes; when this fails
 * the backslash is an escape as before.
 */
export function latexMathSyntax(): Extension {
  return { text: { [BACKSLASH]: { name: "latexMath", tokenize } } };
}

function tokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let close = 0;
  let citation = true;
  return start;

  // The formula is chunks of one line each, with line endings of their own
  // between them, as a code span is: micromark takes a token with nothing
  // inside it that spans lines for a line ending.
  function start(code: Code): State | undefined {
    effects.enter("latexMath");
    effects.enter("latexMathChunk");
    effects.consume(code);
    return open;
  }

  function open(code: Code): State | undefined {
    if (code === null || !(code in CLOSER)) return nok(code);
    close = CLOSER[code];
    effects.consume(code);
    return inside;
  }

  function inside(code: Code): State | undefined {
    if (code === null || code === GRAVE) return nok(code);
    if (isLineEnding(code)) {
      effects.exit("latexMathChunk");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      effects.enter("latexMathChunk");
      return inside;
    }
    if (code === BACKSLASH) {
      effects.consume(code);
      return escaped;
    }
    citation &&= isCitationCode(code);
    effects.consume(code);
    return inside;
  }

  // After a backslash: the closer, or the rest of a command (`\\`, `\{`,
  // `\alpha`), whose next character can't close the formula.
  function escaped(code: Code): State | undefined {
    if (code === close) {
      if (citation) return nok(code);
      effects.consume(code);
      effects.exit("latexMathChunk");
      effects.exit("latexMath");
      return ok;
    }
    citation = false;
    if (code === null || code === GRAVE || isLineEnding(code))
      return inside(code);
    effects.consume(code);
    return inside;
  }
}

// A line that could start a block of its own and so end the paragraph a
// formula sits in - a list item, quote, heading, setext underline, fence,
// HTML or table - judged loosely: a formula that might is written in dollars.
const BLOCK_START = /\n[ \t]*(?:[-+*>#=_|<]|`{3}|~{3}|\d+[.)])/;

/**
 * `value` written between the LaTeX `delimiter` ("\\(" or "\\["), on lines
 * of its own when `ownLines`, or null when it would not read back as the
 * same formula: empty or a citation's characters only, holding a backtick,
 * the closer or a blank line, or with a line that could start a block. The
 * caller writes it in dollars instead.
 */
export function writeLatexMath(
  value: string,
  delimiter: string,
  ownLines: boolean,
): string | null {
  const close = delimiter === "\\(" ? ")" : delimiter === "\\[" ? "]" : null;
  if (!close) return null;
  if (
    [...value].every((c) => /[\d,\s-]/.test(c)) ||
    value.includes("`") ||
    /\n[ \t]*\n/.test(value)
  )
    return null;
  // A backslash pairs with the character after it (see `escaped` above):
  // one before the closer, or last of all, would end the formula early.
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") continue;
    if (i + 1 === value.length || value[i + 1] === close) return null;
    i++;
  }
  const body = ownLines ? `\n${value}\n` : value;
  if (BLOCK_START.test(body)) return null;
  return `${delimiter}${body}\\${close}`;
}

/** mdast: an `inlineMath` node whose `data.mathDelimiter` names the opener. */
export function latexMathFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      // The node's value is read whole from the source on exit; the buffer
      // takes the line endings inside, which would otherwise be added to
      // it as text.
      latexMath(this: CompileContext, token: Token) {
        this.enter(
          { type: "inlineMath", value: "" } as unknown as Parameters<
            CompileContext["enter"]
          >[0],
          token,
        );
        this.buffer();
      },
    },
    exit: {
      latexMath(this: CompileContext, token: Token) {
        this.resume();
        const node = this.stack[this.stack.length - 1] as MdastNode;
        const raw = this.sliceSerialize(token);
        node.value = raw.slice(2, -2);
        node.data = { ...node.data, mathDelimiter: raw.slice(0, 2) };
        this.exit(token);
      },
    },
  };
}

/**
 * A `\[...\]` that is a paragraph of its own is display math - a math
 * block, as `$$` makes - whether on one line or with the delimiters on
 * lines of their own (recorded as `oneLine`, to write it back the same).
 * Anywhere else in a paragraph it stays inline.
 */
export function displayLatexBlocks(tree: MdastNode): void {
  const walk = (parent: MdastNode) => {
    if (!parent.children) return;
    parent.children = parent.children.map((child) => {
      walk(child);
      const only = child.children?.[0];
      if (
        child.type !== "paragraph" ||
        child.children?.length !== 1 ||
        only?.type !== "inlineMath" ||
        only.data?.mathDelimiter !== "\\["
      )
        return child;
      const value = only.value ?? "";
      const lead = /^[ \t]*\r?\n/.exec(value)?.[0] ?? "";
      const trail = /\r?\n[ \t]*$/.exec(value)?.[0] ?? "";
      return {
        type: "math",
        value: value.slice(lead.length, value.length - trail.length),
        data: { mathDelimiter: "\\[", oneLine: !lead && !trail },
        position: child.position,
      };
    });
  };
  walk(tree);
}
