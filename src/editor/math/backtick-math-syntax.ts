// GitHub's unambiguous inline math, $`...`$: a dollar and a backtick each
// side, read as math with the delimiter kept so a save writes it back. The
// formula holds anything but a backtick or a line ending, dollars and
// backslashes included; anything else is a dollar beside inline code.
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
import { afterDollar } from "./dollar-math-syntax";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    backtickMath: "backtickMath";
  }
}

const DOLLAR = 36;
const GRAVE = 96;

/** The opener as the file has it, and as `data.mathDelimiter` records it. */
export const BACKTICK_MATH_OPEN = "$`";
const BACKTICK_MATH_CLOSE = "`$";

/** The formula written in GitHub's form, or null when it can't read back
 *  so (empty, or holding a backtick or a line ending). */
export function writeBacktickMath(value: string): string | null {
  return value && !/[`\r\n]/.test(value)
    ? BACKTICK_MATH_OPEN + value + BACKTICK_MATH_CLOSE
    : null;
}

/** micromark syntax: `$`...`$` in text. Pushed after the dollar rules, so
 *  tried before them. */
export function backtickMathSyntax(): Extension {
  return { text: { [DOLLAR]: { name: "backtickMath", tokenize } } };
}

function tokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const follows = afterDollar(this);
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    if (follows) return nok(code);
    effects.enter("backtickMath");
    effects.consume(code);
    return open;
  }

  function open(code: Code): State | undefined {
    if (code !== GRAVE) return nok(code);
    effects.consume(code);
    return inside;
  }

  function inside(code: Code): State | undefined {
    if (code === null || code < -2) return nok(code);
    effects.consume(code);
    if (code === GRAVE) return size ? close : nok;
    size++;
    return inside;
  }

  function close(code: Code): State | undefined {
    if (code !== DOLLAR) return nok(code);
    effects.consume(code);
    effects.exit("backtickMath");
    return ok;
  }
}

/** mdast: an `inlineMath` node whose `data.mathDelimiter` is "$`". */
export function backtickMathFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      backtickMath(this: CompileContext, token: Token) {
        this.enter(
          { type: "inlineMath", value: "" } as Parameters<
            CompileContext["enter"]
          >[0],
          token,
        );
        this.buffer();
      },
    },
    exit: {
      backtickMath(this: CompileContext, token: Token) {
        this.resume();
        const node = this.stack[this.stack.length - 1] as {
          value?: string;
          data?: Record<string, unknown>;
        };
        node.value = this.sliceSerialize(token).slice(2, -2);
        node.data = { ...node.data, mathDelimiter: BACKTICK_MATH_OPEN };
        this.exit(token);
      },
    },
  };
}
