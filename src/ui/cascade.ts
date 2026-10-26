import { animate, duration, motionAllowed } from "./motion";

/**
 * Written text coming in a word at a time, each word fading in a step
 * after the one before it - as a reply streams in Claude's apps - for text
 * drawn anew whenever more of it arrives: the AI's reply in the chat, a
 * proposal landing in the document. Drawn again (innerHTML), the words
 * already in come back as they were, and a word still fading carries on
 * from where it was rather than starting over: each word keeps the moment
 * it began, by its place in the text. A word fades in place: a span of
 * inline text takes no transform, and one made inline-block would change
 * where the lines break.
 *
 * The step is --dur-stagger, shortened so a run of words never takes more
 * than --dur-cascade: a whole paragraph landing at once comes in quickly,
 * a few words a little at a time. Only opacity moves
 * (docs/design/design-language.md, Motion); with motion off the words are
 * simply there.
 */

/** What a word is cut by: the writing system's own word breaks - Chinese
 *  and Japanese by their words, not each character. */
const WORDS =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/** Parts of a rendered text that are drawn whole: a formula, a diagram, a
 *  picture's frame, code. Their words don't come in one by one. */
const WHOLE = ".katex, svg, .mermaid-preview, .pending-picture, pre";

export class Cascade {
  /** When each word began coming in (performance.now()), by its place. */
  private begun: number[] = [];

  /**
   * Lets the words of `root` that are new since the last call come in, and
   * those still coming in carry on. `root`'s text must start with what it
   * showed last time: more text, not other text (`settle` otherwise).
   * `together`: the new words fade in as one, with no step between them -
   * a batch of whole sentences landing in a line of text.
   */
  play(root: Element, { together = false }: { together?: boolean } = {}): void {
    if (!motionAllowed()) return;
    const now = performance.now();
    const fade = duration("--dur-medium");
    const step = duration("--dur-stagger");
    const budget = duration("--dur-cascade");
    const words = textWords(root);
    const fresh = words.length - this.begun.length;
    if (fresh > 0) {
      // A step that fits the new words into the budget.
      const gap = together ? 0 : Math.min(step, budget / fresh);
      const from = Math.max(now, (this.begun.at(-1) ?? -Infinity) + gap);
      for (let i = 0; i < fresh; i++) this.begun.push(from + i * gap);
    }
    // From the end backwards: wrapping a word splits its text node, which
    // keeps the text before it - and the places of the words there.
    for (let i = words.length - 1; i >= 0; i--) {
      const begun = this.begun[i];
      // Done coming in: left as plain text.
      if (begun === undefined || begun + fade <= now) continue;
      const word = wrap(words[i]);
      if (!word) continue;
      animate(word, [{ opacity: 0 }, { opacity: 1 }], {
        duration: fade,
        easing: "--ease-out",
        delay: begun - now,
        fill: "backwards",
      });
    }
  }

  /** `root`'s words as they stand are in already: the text was replaced,
   *  not added to, and what was there shows at once. */
  settle(root: Element): void {
    this.begun = textWords(root).map(() => -Infinity);
  }
}

interface WordAt {
  node: Text;
  start: number;
  end: number;
}

/** The words of `root`'s text, in order, where each stands. */
function textWords(root: Element): WordAt[] {
  const out: WordAt[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(WHOLE)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const at = (start: number, word: string) =>
      out.push({ node: node as Text, start, end: start + word.length });
    if (WORDS) {
      for (const s of WORDS.segment(text))
        if (s.segment.trim()) at(s.index, s.segment);
    } else {
      for (const m of text.matchAll(/\S+/g)) at(m.index ?? 0, m[0]);
    }
  }
  return out;
}

/** A word's text in a span of its own. */
function wrap({ node, start, end }: WordAt): HTMLElement | null {
  if (!node.parentNode) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const span = document.createElement("span");
  span.className = "cascade-word";
  try {
    range.surroundContents(span);
  } catch {
    return null;
  }
  return span;
}
