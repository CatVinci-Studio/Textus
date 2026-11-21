// Micromark + mdast support for Pandoc's and Typora's "^superscript^" and
// "~subscript~": one mark each side around text with no spaces, as in
// "x^2^", "1^st^" and "H~2~O". Strikethrough is "~~" only, so one tilde
// is a subscript or plain text (a range, "5~10").
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
    subscript: "subscript";
    subscriptMarker: "subscriptMarker";
    subscriptText: "subscriptText";
  }
}

declare module "mdast" {
  interface PhrasingContentMap {
    superscript: Script<"superscript">;
    subscript: Script<"subscript">;
  }
  interface RootContentMap {
    superscript: Script<"superscript">;
    subscript: Script<"subscript">;
  }
}

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    superscript: "superscript";
  }
}

/** Markdown "^superscript^" or "~subscript~". */
interface Script<T extends "superscript" | "subscript"> extends Parent {
  type: T;
  children: PhrasingContent[];
}

const CARET = 94; // "^"
const TILDE = 126; // "~"
const BACKSLASH = 92;
const LEFT_BRACKET = 91; // "["

// Space, tab, line ending or the end: none goes inside either.
const isBreak = (code: Code) => code === null || code < 0 || code === 32;

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
/** What a subscript holds: ASCII letters, digits, `+` and `-` (`H~2~O`,
 *  `a~n-1~`), so a range in other text (`5~10人，20~30人`) stays text. */
export const SUBSCRIPT_TEXT = /^[A-Za-z0-9+-]+$/;

/** One script's mark and the rules around it. */
interface ScriptSpec {
  name: "superscript" | "subscript";
  mark: number;
  /** Whether the character before may open it. */
  opensAfter: (previous: Code) => boolean;
  /** Whether a character may be inside it (escapes aside). */
  holds: (code: number) => boolean;
}

const SUPERSCRIPT: ScriptSpec = {
  name: "superscript",
  mark: CARET,
  // "[^1]" is a footnote, and "^^" no superscript.
  opensAfter: (previous) => previous !== CARET && previous !== LEFT_BRACKET,
  holds: () => true,
};

const SUBSCRIPT: ScriptSpec = {
  name: "subscript",
  mark: TILDE,
  // Only right after a letter or digit, as the typed rule (md-span-runs).
  opensAfter: (previous) =>
    previous !== null &&
    previous > 0 &&
    LETTER_OR_DIGIT.test(String.fromCodePoint(previous)),
  holds: (code) => SUBSCRIPT_TEXT.test(String.fromCodePoint(code)),
};

/** micromark syntax: "^...^" as a "superscript" token. */
export function superscriptSyntax(): Extension {
  return {
    text: {
      [CARET]: { name: "superscript", tokenize: tokenizer(SUPERSCRIPT) },
    },
  };
}

/** micromark syntax: "~...~" as a "subscript" token, never touching "~~". */
export function subscriptSyntax(): Extension {
  return {
    text: { [TILDE]: { name: "subscript", tokenize: tokenizer(SUBSCRIPT) } },
  };
}

function tokenizer(spec: ScriptSpec): Tokenizer {
  const { name, mark } = spec;
  const marker = `${name}Marker` as const;
  const text = `${name}Text` as const;
  return function (
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ) {
    const previous = this.previous;
    let size = 0;
    return start;

    function start(code: Code): State | undefined {
      if (previous === mark || !spec.opensAfter(previous)) return nok(code);
      effects.enter(name);
      effects.enter(marker);
      effects.consume(code);
      effects.exit(marker);
      effects.enter(text);
      return inside;
    }

    function inside(code: Code): State | undefined {
      if (code === mark) {
        if (size === 0) return nok(code);
        effects.exit(text);
        effects.enter(marker);
        effects.consume(code);
        effects.exit(marker);
        return close;
      }
      if (isBreak(code) || (code !== BACKSLASH && !spec.holds(code!)))
        return nok(code);
      size++;
      effects.consume(code);
      return code === BACKSLASH ? escaped : inside;
    }

    // "x~2~~" is no subscript: the run belongs to a strikethrough.
    function close(code: Code): State | undefined {
      if (code === mark && mark === TILDE) return nok(code);
      effects.exit(name);
      return ok(code);
    }

    function escaped(code: Code): State | undefined {
      if (isBreak(code)) return nok(code);
      effects.consume(code);
      return inside;
    }
  };
}

/** mdast for both: a node of the script's name holding its text. */
export function scriptsFromMarkdown(): FromMarkdownExtension {
  const enter = (type: "superscript" | "subscript"): FromMarkdownHandle =>
    function (token) {
      this.enter({ type, children: [] } as Script<typeof type>, token);
    };
  return {
    enter: { superscript: enter("superscript"), subscript: enter("subscript") },
    exit: {
      superscriptText: exitText,
      subscriptText: exitText,
      superscript: exitScript,
      subscript: exitScript,
    },
  };
}

// The text as written, a backslash before punctuation taken as its escape.
const exitText: FromMarkdownHandle = function (token) {
  const value = this.sliceSerialize(token).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  const node = this.stack[this.stack.length - 1] as Parent;
  node.children.push({ type: "text", value });
};

const exitScript: FromMarkdownHandle = function (token) {
  this.exit(token);
};

const CONSTRUCTS_WITHOUT_SCRIPTS: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

export function scriptsToMarkdown(): ToMarkdownExtension {
  return {
    unsafe: [
      // Only a "^" that would open a superscript with a later one is escaped,
      // or "2^10" saves as "2\^10".
      {
        character: "^",
        after: "[^\\s^]+\\^",
        inConstruct: "phrasing",
        notInConstruct: CONSTRUCTS_WITHOUT_SCRIPTS,
      },
      // Inside one, any caret would end it.
      { character: "^", inConstruct: "superscript" },
    ],
    // A subscript is written as a one-tilde strikethrough is (md-span-schema).
    handlers: { superscript: scriptHandler("superscript", "^") },
  };
}

type HandleWithPeek = ToMarkdownHandle & { peek?: ToMarkdownHandle };

function scriptHandler(name: "superscript", mark: string): HandleWithPeek {
  const handle: HandleWithPeek = function (node, _parent, state, info) {
    const tracker = state.createTracker(info);
    const exit = state.enter(name);
    let value = tracker.move(mark);
    value += state.containerPhrasing(node as Script<typeof name>, {
      ...tracker.current(),
      before: value,
      after: mark,
    });
    value += tracker.move(mark);
    exit();
    return value;
  };
  handle.peek = () => mark;
  return handle;
}
