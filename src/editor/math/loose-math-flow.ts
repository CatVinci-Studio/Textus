// Display maths written loosely, as many editors and AI tools write it:
// the formula starting on the `$$` line (`$$x = 1`) or ending on the
// closing one (`y = 2$$`). remark-math reads the first as the fence's info
// and the second as no fence at all, so the formula's first line went and
// the rest of the document became maths. Read here as the same `math` node
// a fenced formula makes; a formula fenced as CommonMark wants is left to
// remark-math, so it reads and saves as before.
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  TokenizeContext,
  TokenType,
} from "micromark-util-types";

const DOLLAR = 36;
const BACKSLASH = 92;

/** CR, LF and CRLF are -5, -4 and -3 in micromark. */
const isLineEnding = (code: Code) => code !== null && code < -2;
const isSpace = (code: Code) => code === -2 || code === -1 || code === 32;

// remark-math's own tokens, so its mdast handlers build the node.
const FLOW = "mathFlow" as TokenType;
const FENCE = "mathFlowFence" as TokenType;
const SEQUENCE = "mathFlowFenceSequence" as TokenType;
const VALUE = "mathFlowValue" as TokenType;
const LINE_ENDING = "lineEnding" as TokenType;
const WHITESPACE = "whitespace" as TokenType;
const DATA = "data" as TokenType;

/** Ahead of remark-math's own `$$`. */
export function looseMathFlow(): Extension {
  return {
    flow: {
      [DOLLAR]: {
        name: "looseMathFlow",
        tokenize,
        concrete: true,
        add: "before",
      },
    },
  } as Extension;
}

/** The next line is the block's, not a lazy one a container left. */
const nonLazyContinuation: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const lazy = () => this.parser.lazy[this.now().line];
    return (code) => {
      if (code === null) return ok(code);
      effects.enter(LINE_ENDING);
      effects.consume(code);
      effects.exit(LINE_ENDING);
      return (next: Code) => (lazy() ? nok : ok)(next);
    };
  },
};

/**
 * Whether the `$$` here opens a loose formula: one with words on its opening
 * line (and not closed on it: `$$x$$` is inline), or one whose closing `$$`
 * ends a line of the formula; either closed before the document ends.
 */
const looseAhead: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let size = 0;
    let firstLine = true;
    let loose = false;
    let words = false;
    // The dollars ending the line so far, after words.
    let run = 0;
    let escaped = false;
    return (code) => {
      effects.enter(DATA);
      return open(code);
    };

    function open(code: Code): State | undefined {
      if (code === DOLLAR) {
        size++;
        effects.consume(code);
        return open;
      }
      return size < 2 ? nok(code) : line(code);
    }

    function line(code: Code): State | undefined {
      if (code === null || isLineEnding(code)) return lineEnd(code);
      if (escaped) escaped = false;
      else if (code === BACKSLASH) escaped = true;
      if (code === DOLLAR && !escaped) run++;
      else if (!isSpace(code)) {
        // Dollars followed by words were the formula's, not a fence.
        run = 0;
        words = true;
      }
      effects.consume(code);
      return line;
    }

    function lineEnd(code: Code): State | undefined {
      const closes = words && run >= size;
      if (firstLine) {
        firstLine = false;
        // `$$x$$` is inline maths; `$$x` opens a loose formula, once a
        // closing `$$` comes (a price at a line's start, `$$5 off`, does not).
        if (closes) return nok(code);
        loose = words;
      } else if (!words && run >= size) {
        // A `$$` line of its own: the close of a loose formula, or one
        // fenced as remark-math wants.
        return loose ? ok(code) : nok(code);
      } else if (closes) return ok(code);
      if (code === null) return nok(code);
      words = false;
      run = 0;
      escaped = false;
      effects.consume(code);
      return line;
    }
  },
};

function tokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const interrupting = () => this.interrupt;
  let size = 0;
  let escaped = false;
  const closingHere: Construct = { partial: true, tokenize: closesHere };
  return (code) => effects.check(looseAhead, begin, nok)(code);

  function begin(code: Code): State | undefined {
    effects.enter(FLOW);
    effects.enter(FENCE);
    effects.enter(SEQUENCE);
    return open(code);
  }

  function open(code: Code): State | undefined {
    if (code === DOLLAR) {
      size++;
      effects.consume(code);
      return open;
    }
    effects.exit(SEQUENCE);
    if (isSpace(code)) {
      effects.enter(WHITESPACE);
      return space(code);
    }
    return afterOpen(code);
  }

  function space(code: Code): State | undefined {
    if (isSpace(code)) {
      effects.consume(code);
      return space;
    }
    effects.exit(WHITESPACE);
    return afterOpen(code);
  }

  function afterOpen(code: Code): State | undefined {
    effects.exit(FENCE);
    if (interrupting()) return ok(code);
    return lineStart(code);
  }

  function lineStart(code: Code): State | undefined {
    if (code === null) return done(code);
    if (isLineEnding(code))
      return effects.attempt(nonLazyContinuation, lineStart, done)(code);
    // A `$$` line of its own closes it.
    if (code === DOLLAR)
      return effects.check(closingHere, closeFence, startValue)(code);
    return startValue(code);
  }

  function startValue(code: Code): State | undefined {
    effects.enter(VALUE);
    escaped = false;
    return chunk(code);
  }

  function chunk(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit(VALUE);
      return lineStart(code);
    }
    if (code === DOLLAR && !escaped)
      return effects.check(closingHere, endValue, dollar)(code);
    escaped = !escaped && code === BACKSLASH;
    effects.consume(code);
    return chunk;
  }

  function dollar(code: Code): State | undefined {
    effects.consume(code);
    return chunk;
  }

  function endValue(code: Code): State | undefined {
    effects.exit(VALUE);
    return closeFence(code);
  }

  function closeFence(code: Code): State | undefined {
    effects.enter(FENCE);
    effects.enter(SEQUENCE);
    return closing(code);
  }

  function closing(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      return closing;
    }
    effects.exit(SEQUENCE);
    if (isSpace(code)) {
      effects.enter(WHITESPACE);
      return closingSpace(code);
    }
    effects.exit(FENCE);
    return done(code);
  }

  function closingSpace(code: Code): State | undefined {
    if (isSpace(code)) {
      effects.consume(code);
      return closingSpace;
    }
    effects.exit(WHITESPACE);
    effects.exit(FENCE);
    return done(code);
  }

  function done(code: Code): State | undefined {
    effects.exit(FLOW);
    return ok(code);
  }

  /** Dollars here as many as opened it, then only spaces to the line's end. */
  function closesHere(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    let count = 0;
    return (code) => {
      effects.enter(DATA);
      return run(code);
    };
    function run(code: Code): State | undefined {
      if (code === DOLLAR) {
        count++;
        effects.consume(code);
        return run;
      }
      return count >= size ? rest(code) : nok(code);
    }
    function rest(code: Code): State | undefined {
      if (code === null || isLineEnding(code)) return ok(code);
      if (!isSpace(code)) return nok(code);
      effects.consume(code);
      return rest;
    }
  }
}
