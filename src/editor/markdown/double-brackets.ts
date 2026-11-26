import type {
  Code,
  Effects,
  Extension,
  State,
  TokenizeContext,
  TokenType,
} from "micromark-util-types";

const BANG = 33; // "!"
const OPEN = 91; // "["
const CLOSE = 93; // "]"
const PAREN = 40; // "("

/** micromark: `[[...]]`, or `![[...]]` with `bang`, as one token, so a "_"
 *  in a name isn't emphasis. Nothing empty, no "[" or line break inside.
 *  `refuseParen`: `[[x]](url)`, a link whose text has brackets, is left to
 *  CommonMark. */
export function doubleBracketSyntax(
  type: TokenType,
  { bang, refuseParen }: { bang: boolean; refuseParen: boolean },
): Extension {
  return {
    text: { [bang ? BANG : OPEN]: { name: type, tokenize } },
  };

  function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    let brackets = 0;
    let empty = true;
    return start;

    function start(code: Code): State | undefined {
      effects.enter(type);
      if (!bang) return open(code);
      effects.consume(code);
      return open;
    }
    function open(code: Code): State | undefined {
      if (code !== OPEN) return nok(code);
      effects.consume(code);
      return ++brackets === 2 ? inside : open;
    }
    function inside(code: Code): State | undefined {
      // Negative codes are line endings and tabs.
      if (code === null || code < 0 || code === OPEN) return nok(code);
      if (code === CLOSE && empty) return nok(code);
      effects.consume(code);
      if (code === CLOSE) return closeSecond;
      empty = false;
      return inside;
    }
    function closeSecond(code: Code): State | undefined {
      if (code !== CLOSE) return nok(code);
      effects.consume(code);
      return after;
    }
    function after(code: Code): State | undefined {
      if (refuseParen && code === PAREN) return nok(code);
      effects.exit(type);
      return ok(code);
    }
  }
}
