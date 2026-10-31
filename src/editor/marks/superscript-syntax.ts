// Micromark + mdast support for Pandoc's and Typora's "^superscript^": one
// caret each side around text with no spaces, as in "x^2^" and "1^st^".
import type {
  Code,
  Effects,
  Extension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";
import type {
  Extension as FromMarkdownExtension,
  Handle as FromMarkdownHandle,
} from "mdast-util-from-markdown";
import type {
  ConstructName,
  Handle as ToMarkdownHandle,
  Options as ToMarkdownExtension,
} from "mdast-util-to-markdown";
import type { Parent, PhrasingContent } from "mdast";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    superscript: "superscript";
    superscriptMarker: "superscriptMarker";
    superscriptText: "superscriptText";
  }
}

declare module "mdast" {
  interface PhrasingContentMap {
    superscript: Superscript;
  }
  interface RootContentMap {
    superscript: Superscript;
  }
}

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    superscript: "superscript";
  }
}

/** Markdown "^superscript^". */
export interface Superscript extends Parent {
  type: "superscript";
  children: PhrasingContent[];
}

const CARET = 94; // "^"
const BACKSLASH = 92;
const LEFT_BRACKET = 91; // "["

// Space, tab, line ending or the end: none goes inside a superscript.
const isBreak = (code: Code) => code === null || code < 0 || code === 32;

/** micromark syntax: "^...^" as a "superscript" token. */
export function superscriptSyntax(): Extension {
  return {
    text: { [CARET]: { name: "superscript", tokenize: tokenizeSuperscript } },
  };
}

const tokenizeSuperscript: Tokenizer = function (
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
) {
  // "[^1]" is a footnote, and "^^" no superscript.
  const previous = this.previous;
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    if (previous === CARET || previous === LEFT_BRACKET) return nok(code);
    effects.enter("superscript");
    effects.enter("superscriptMarker");
    effects.consume(code);
    effects.exit("superscriptMarker");
    effects.enter("superscriptText");
    return inside;
  }

  function inside(code: Code): State | undefined {
    if (code === CARET) {
      if (size === 0) return nok(code);
      effects.exit("superscriptText");
      effects.enter("superscriptMarker");
      effects.consume(code);
      effects.exit("superscriptMarker");
      effects.exit("superscript");
      return ok;
    }
    if (isBreak(code)) return nok(code);
    size++;
    effects.consume(code);
    return code === BACKSLASH ? escaped : inside;
  }

  function escaped(code: Code): State | undefined {
    if (isBreak(code)) return nok(code);
    effects.consume(code);
    return inside;
  }
};

export function superscriptFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { superscript: enterSuperscript },
    exit: {
      superscriptText: exitSuperscriptText,
      superscript: exitSuperscript,
    },
  };
}

const enterSuperscript: FromMarkdownHandle = function (token) {
  this.enter({ type: "superscript", children: [] } as Superscript, token);
};

// The text as written, a backslash before punctuation taken as its escape.
const exitSuperscriptText: FromMarkdownHandle = function (token) {
  const value = this.sliceSerialize(token).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  const node = this.stack[this.stack.length - 1] as Superscript;
  node.children.push({ type: "text", value });
};

const exitSuperscript: FromMarkdownHandle = function (token) {
  this.exit(token);
};

const CONSTRUCTS_WITHOUT_SUPERSCRIPT: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

export function superscriptToMarkdown(): ToMarkdownExtension {
  return {
    unsafe: [
      // Only a "^" that would open a superscript with a later one is escaped,
      // or "2^10" saves as "2\^10".
      {
        character: "^",
        after: "[^\\s^]+\\^",
        inConstruct: "phrasing",
        notInConstruct: CONSTRUCTS_WITHOUT_SUPERSCRIPT,
      },
      // Inside one, any caret or space would end it.
      { character: "^", inConstruct: "superscript" },
    ],
    handlers: { superscript: handleSuperscript },
  };
}

type HandleWithPeek = ToMarkdownHandle & { peek?: ToMarkdownHandle };

const handleSuperscript: HandleWithPeek = function (
  node,
  _parent,
  state,
  info,
) {
  const tracker = state.createTracker(info);
  const exit = state.enter("superscript");
  let value = tracker.move("^");
  value += state.containerPhrasing(node as Superscript, {
    ...tracker.current(),
    before: value,
    after: "^",
  });
  value += tracker.move("^");
  exit();
  return value;
};
handleSuperscript.peek = () => "^";
