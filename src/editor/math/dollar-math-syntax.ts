// Pandoc's rule for single-dollar math, ahead of remark-math (which pairs
// any two dollars): no space just inside either `$`, no digit right after
// the closing one. A `$` that can't open by it is text, and the next `$` is
// tried afresh, so "costs $5, a $x$ thing" keeps its formula.
import type {
  Code,
  Effects,
  Extension,
  State,
  TokenizeContext,
} from "micromark-util-types";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    dollarMathCheck: "dollarMathCheck";
  }
}

const DOLLAR = 36;
const GRAVE = 96;

/** Space, tab or line ending (micromark's codes below zero). */
const isWhitespace = (code: Code) => code === 32 || (code !== null && code < 0);
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57;
const isLineEnding = (code: Code) => code !== null && code < -2;

/** Whether the `$` here follows another one, not a `\$` (as remark-math
 *  tells them apart): a run, or a formula's closer, is remark-math's. */
export function afterDollar(context: TokenizeContext): boolean {
  return (
    context.previous === DOLLAR &&
    context.events.at(-1)?.[1].type !== "characterEscape"
  );
}

/** micromark syntax: a lone `$` that opens no Pandoc formula, as text.
 *  Pushed after remark-math's, so tried before it. */
export function dollarMathSyntax(): Extension {
  return { text: { [DOLLAR]: { name: "dollarMath", tokenize } } };
}

function tokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const follows = afterDollar(this);
  return start;

  // A formula, a run of dollars or one opened after a `$`: remark-math's.
  function start(code: Code): State | undefined {
    if (follows) return nok(code);
    return effects.check(
      { tokenize: opensFormula, partial: true },
      nok,
      text,
    )(code);
  }

  function text(code: Code): State | undefined {
    effects.enter("data");
    effects.consume(code);
    effects.exit("data");
    return ok;
  }
}

/** Succeeds where remark-math should read the `$` here: a run of two or
 *  more, one with no closer at all, or a Pandoc formula. The closer is the
 *  first lone `$` after, as remark-math pairs them. */
function opensFormula(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let before: Code = DOLLAR;
  let run = 0;
  return start;

  function start(code: Code): State | undefined {
    effects.enter("dollarMathCheck");
    effects.consume(code);
    return first;
  }

  function first(code: Code): State | undefined {
    if (code === DOLLAR) return ok(code);
    // "$`" is GitHub's math (backtick-math-syntax) or a dollar before code.
    if (code === GRAVE) return nok(code);
    if (code === null || isWhitespace(code)) return nok(code);
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (code === null) return ok(code);
    if (code === DOLLAR) {
      run = 0;
      return dollars(code);
    }
    // One token a line, as micromark wants line endings apart.
    if (isLineEnding(code)) {
      effects.exit("dollarMathCheck");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      effects.enter("dollarMathCheck");
    } else effects.consume(code);
    before = code;
    return inside;
  }

  function dollars(code: Code): State | undefined {
    if (code === DOLLAR) {
      run++;
      effects.consume(code);
      return dollars;
    }
    if (run !== 1) {
      before = DOLLAR;
      return inside(code);
    }
    return isWhitespace(before) || isDigit(code) ? nok(code) : ok(code);
  }
}
