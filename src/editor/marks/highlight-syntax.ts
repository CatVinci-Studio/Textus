// Micromark + mdast support for "==highlighted==", modeled on
// gfm-strikethrough but with a fixed 2-character delimiter.
import { splice } from "micromark-util-chunked";
import { classifyCharacter } from "micromark-util-classify-character";
import { resolveAll } from "micromark-util-resolve-all";
import type {
  Effects,
  Event,
  Extension,
  State,
  Token,
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
    highlightSequence: "highlightSequence";
    highlightSequenceTemporary: "highlightSequenceTemporary";
    highlight: "highlight";
    highlightText: "highlightText";
  }
}

/** Markdown "==highlighted==" text, registered below. */
export interface Mark extends Parent {
  type: "mark";
  children: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    mark: Mark;
  }
  interface RootContentMap {
    mark: Mark;
  }
}

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    highlight: "highlight";
  }
}

const EQUALS = 61; // "="

/** Whether a code point is CJK (ideographs, kana, hangul, CJK punctuation
 *  and fullwidth forms). Curly quotes, shared with English, stay strict. */
function isCjkCode(code: number | null): boolean {
  if (code === null) return false;
  return (
    (code >= 0x2e80 && code <= 0x303f) || // CJK radicals + CJK punctuation
    (code >= 0x3040 && code <= 0x30ff) || // kana
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xac00 && code <= 0xd7af) || // hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xffef) // fullwidth/halfwidth forms
  );
}

const CONSTRUCTS_WITHOUT_HIGHLIGHT: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

/** micromark syntax: "==...==" as a "highlight" token, by gfm-strikethrough's
 *  flanking-run algorithm. */
export function highlightSyntax(): Extension {
  const tokenizer = {
    name: "highlight",
    tokenize: tokenizeHighlight,
    resolveAll: resolveAllHighlight,
  };
  return {
    text: { [EQUALS]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [EQUALS] },
  };

  function resolveAllHighlight(
    events: Event[],
    context: TokenizeContext,
  ): Event[] {
    let index = -1;
    while (++index < events.length) {
      if (
        events[index][0] === "enter" &&
        events[index][1].type === "highlightSequenceTemporary" &&
        events[index][1]._close
      ) {
        let open = index;
        while (open--) {
          if (
            events[open][0] === "exit" &&
            events[open][1].type === "highlightSequenceTemporary" &&
            events[open][1]._open &&
            events[index][1].end.offset - events[index][1].start.offset ===
              events[open][1].end.offset - events[open][1].start.offset
          ) {
            events[index][1].type = "highlightSequence";
            events[open][1].type = "highlightSequence";

            const highlight: Token = {
              type: "highlight",
              start: { ...events[open][1].start },
              end: { ...events[index][1].end },
            };
            const text: Token = {
              type: "highlightText",
              start: { ...events[open][1].end },
              end: { ...events[index][1].start },
            };

            const nextEvents: Event[] = [
              ["enter", highlight, context],
              ["enter", events[open][1], context],
              ["exit", events[open][1], context],
              ["enter", text, context],
            ];
            const insideSpan = context.parser.constructs.insideSpan.null;
            if (insideSpan) {
              splice(
                nextEvents,
                nextEvents.length,
                0,
                resolveAll(insideSpan, events.slice(open + 1, index), context),
              );
            }
            splice(nextEvents, nextEvents.length, 0, [
              ["exit", text, context],
              ["enter", events[index][1], context],
              ["exit", events[index][1], context],
              ["exit", highlight, context],
            ]);
            splice(events, open - 1, index - open + 3, nextEvents);
            index = open + nextEvents.length - 2;
            break;
          }
        }
      }
    }
    index = -1;
    while (++index < events.length) {
      if (events[index][1].type === "highlightSequenceTemporary") {
        events[index][1].type = "data";
      }
    }
    return events;
  }

  function tokenizeHighlight(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): ReturnType<Tokenizer> {
    const previous = this.previous;
    const events = this.events;
    let size = 0;
    return start;

    function start(code: number | null) {
      if (
        previous === EQUALS &&
        events[events.length - 1][1].type !== "characterEscape"
      ) {
        return nok(code);
      }
      effects.enter("highlightSequenceTemporary");
      return more(code);
    }

    function more(code: number | null): State | undefined {
      const before = classifyCharacter(previous);
      if (code === EQUALS) {
        if (size > 1) return nok(code); // more than 2 in a row is not ours
        effects.consume(code);
        size++;
        return more;
      }
      if (size !== 2) return nok(code); // require exactly 2, no "single =" form
      const token = effects.exit("highlightSequenceTemporary");
      const after = classifyCharacter(code);
      // CJK relaxation, as remark-cjk-friendly does for emphasis: flanking rules
      // reject "==“高亮”==吗", but CJK prose has no spaces. A delimiter touching a
      // CJK character may open/close unless it faces whitespace.
      const cjkAdjacent = isCjkCode(previous) || isCjkCode(code);
      token._open =
        !after ||
        (after === 2 && Boolean(before)) ||
        (cjkAdjacent && after !== 1);
      token._close =
        !before ||
        (before === 2 && Boolean(after)) ||
        (cjkAdjacent && before !== 1);
      return ok(code);
    }
  }
}

export function highlightFromMarkdown(): FromMarkdownExtension {
  return {
    canContainEols: ["highlight"],
    enter: { highlight: enterHighlight },
    exit: { highlight: exitHighlight },
  };
}

const enterHighlight: FromMarkdownHandle = function (token) {
  this.enter({ type: "mark", children: [] } as Mark, token);
};

const exitHighlight: FromMarkdownHandle = function (token) {
  this.exit(token);
};

export function highlightToMarkdown(): ToMarkdownExtension {
  return {
    // Only an "=" that could open a highlight with the next one is escaped, or
    // "2+2=4" saves as "2+2\\=4".
    unsafe: [
      {
        character: "=",
        after: "=(?!\\s)",
        inConstruct: "phrasing",
        notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT,
      },
    ],
    handlers: { mark: handleMark },
  };
}

type HandleWithPeek = ToMarkdownHandle & { peek?: ToMarkdownHandle };

const handleMark: HandleWithPeek = function (node, _parent, state, info) {
  const tracker = state.createTracker(info);
  const exit = state.enter("highlight");
  let value = tracker.move("==");
  value += state.containerPhrasing(node as Mark, {
    ...tracker.current(),
    before: value,
    after: "=",
  });
  value += tracker.move("==");
  exit();
  return value;
};
handleMark.peek = () => "=";
