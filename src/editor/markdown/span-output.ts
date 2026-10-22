import { type Handle } from "mdast-util-to-markdown";
import { writeLatexMath } from "../math/latex-math-syntax";
import type { PeekingHandle } from "./link-output";

/**
 * Bold, italic, strikethrough, highlight and maths written so they read
 * back the same: adjacent spans joined, markers alternated when nested,
 * edges encoded where a delimiter would not flank, tildes and dollars as
 * typed (markdown-output.ts).
 */

/**
 * Writes a strikethrough with as many tildes as it was read with (see
 * remarkStrikethroughTildes in md-span-schema.ts): `~x~` stays single. It
 * wraps whichever `delete` handler the extensions installed - the
 * CJK-friendly one - for this one serialization, as `list` does listItem.
 */
export function withTildesAsWritten(del: Handle): Handle {
  return Object.assign(
    ((node, parent, state, info) => {
      const out = del(node, parent, state, info);
      const single = (node.data as { tildes?: number } | undefined)?.tildes;
      return single === 1 && out.startsWith("~~") && out.endsWith("~~")
        ? `~${out.slice(2, -2)}~`
        : out;
    }) as Handle,
    { peek: (del as Partial<PeekingHandle>).peek },
  );
}

export type MathData =
  { mathDelimiter?: string; oneLine?: boolean } | undefined;

/**
 * Writes inline math in the delimiter it was read with - remark-math writes
 * the fewest dollars that work: as many dollars as the file had (see
 * recordDollarRuns in math-schema.ts), so an inline `$$x$$` stays as it
 * was, or LaTeX's `\(x\)` / `\[x\]` (latex-math-syntax.ts). Wraps
 * remark-math's handler for this one serialization, as above.
 */
export function withInlineMathAsWritten(inlineMath: Handle): Handle {
  const latex = (node: { value?: string; data?: unknown }) => {
    const wanted = (node.data as MathData)?.mathDelimiter;
    return wanted ? writeLatexMath(node.value ?? "", wanted, false) : null;
  };
  const peek = (inlineMath as Partial<PeekingHandle>).peek;
  return Object.assign(
    ((node, parent, state, info) => {
      const written = latex(node);
      if (written) return written;
      const out = inlineMath(node, parent, state, info);
      const wanted = (node.data as MathData)?.mathDelimiter;
      const used = /^\$+/.exec(out)?.[0] ?? "";
      return wanted && /^\$+$/.test(wanted) && wanted.length > used.length
        ? wanted + out.slice(used.length, out.length - used.length) + wanted
        : out;
    }) as Handle,
    {
      peek: ((node, parent, state, info) =>
        latex(node) ? "\\" : peek?.(node, parent, state, info)) as Handle,
    },
  );
}

/** A math block read as `\[...\]` is written that way again, on one line
 *  or with the delimiters on lines of their own, as it was. */
export function withMathBlockAsWritten(math: Handle): Handle {
  return ((node, parent, state, info) => {
    const data = node.data as MathData;
    const written =
      data?.mathDelimiter &&
      writeLatexMath(node.value ?? "", data.mathDelimiter, !data.oneLine);
    return written || math(node, parent, state, info);
  }) as Handle;
}

export interface Phrasing {
  type: string;
  data?: unknown;
  value?: string;
  children?: Phrasing[];
  /** The delimiter Milkdown's strong and emphasis handlers write: "_"
   *  for italic read or typed with underscores, and see
   *  alternateNestedMarkers. */
  marker?: string;
}

export const SPANS = new Set(["strong", "emphasis", "delete", "mark"]);

/** Inline math written between dollars, not LaTeX's `\\(...\\)`. */
export const inDollars = (node: Phrasing | undefined) =>
  node?.type === "inlineMath" &&
  !(node.data as MathData)?.mathDelimiter?.startsWith("\\");

/**
 * Inline nodes that can't stand side by side in Markdown - left so when
 * the words between them were deleted - written so they read back:
 *
 * - Two spans of one kind become one: `**foo****bar**` reads back as text
 *   with eight asterisks in it, not as bold.
 * - Two code spans become one: in `` `a``b` `` the second's opening
 *   backtick runs into the first's closing one, and the code reads "a``b".
 * - Two formulas get a space between them: `$a$$b$` reads as one formula,
 *   "a$$b", and the text after it swallowed into maths.
 */
export function joinAdjacent(node: Phrasing): void {
  if (!node.children) return;
  const children: Phrasing[] = [];
  for (const child of node.children) {
    const last = children.at(-1);
    if (
      last?.type === child.type &&
      SPANS.has(child.type) &&
      JSON.stringify(last.data) === JSON.stringify(child.data)
    )
      children[children.length - 1] = {
        ...last,
        children: [...(last.children ?? []), ...(child.children ?? [])],
      };
    else if (last?.type === "inlineCode" && child.type === "inlineCode")
      children[children.length - 1] = {
        ...last,
        value: (last.value ?? "") + (child.value ?? ""),
      };
    else {
      if (inDollars(last) && inDollars(child))
        children.push({ type: "text", value: " " });
      children.push(child);
    }
  }
  node.children = children;
  children.forEach(joinAdjacent);
}

/** The first or last character a node is written with, nested spans and
 *  all. A link, an image, code or maths starts and ends with punctuation
 *  (`[`, `)`, a backtick, `$`), whatever is inside. */
export function edgeCharacter(node: Phrasing, end: "first" | "last"): string {
  if (node.type === "text") {
    const chars = [...(node.value ?? "")];
    return (end === "first" ? chars[0] : chars.at(-1)) ?? "";
  }
  if (!ATTENTION.has(node.type)) return node.type === "break" ? "" : ".";
  return innerEdgeCharacter(node, end);
}

/** The first or last character of a span's text, inside its delimiters. */
export function innerEdgeCharacter(
  span: Phrasing,
  end: "first" | "last",
): string {
  if (!span.children?.length) return "";
  const child = span.children[end === "first" ? 0 : span.children.length - 1];
  // A span inside written with other delimiters doesn't join this one's.
  return ATTENTION.has(child.type) && child.marker === "_"
    ? "_"
    : edgeCharacter(child, end);
}

export const ATTENTION = new Set(["strong", "emphasis"]);
/** Spans whose delimiters open and close by the same rule as bold's:
 *  GFM's strikethrough and the highlight (highlight-syntax.ts). */
export const FLANKED = new Set([...ATTENTION, "delete", "mark"]);
export const PUNCTUATION = /^[\p{P}\p{S}]$/u;
// CJK text is read by remark-cjk-friendly, which lets bold stand against it.
export const WORD =
  /^(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}])[\p{L}\p{N}]$/u;

/** `text` with its first or last character as a character reference, an
 *  inline HTML node (which is written as it is), and the rest. */
export function referenced(text: Phrasing, end: "first" | "last"): Phrasing[] {
  const chars = [...(text.value ?? "")];
  const char = end === "first" ? chars.shift()! : chars.pop()!;
  const html: Phrasing = {
    type: "html",
    value: `&#x${char.codePointAt(0)!.toString(16).toUpperCase()};`,
  };
  const rest: Phrasing[] = chars.length
    ? [{ ...text, value: chars.join("") }]
    : [];
  return end === "first" ? [html, ...rest] : [...rest, html];
}

/**
 * Bold or italic whose text starts or ends with punctuation, right against
 * a word: `**per file.**Pasted` doesn't close (a closing `**` after
 * punctuation needs a space or punctuation after it), so the bold read
 * back as text with asterisks in it - text typed or pasted straight after
 * a bold sentence. The word's letter beside it is written as a character
 * reference, `**per file.**&#x50;asted`, which reads as the letter, as
 * remark itself does; CJK text is left alone. The same for strikethrough
 * and highlight: `~~`code`~~` lost its line once a word was typed against
 * it.
 */
export function encodeAroundAttention(node: Phrasing): void {
  if (!node.children) return;
  node.children.forEach(encodeAroundAttention);
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const span = children[i];
    if (!FLANKED.has(span.type)) continue;
    const before = children[i - 1];
    const after = children[i + 1];
    if (
      after?.type === "text" &&
      PUNCTUATION.test(innerEdgeCharacter(span, "last")) &&
      WORD.test(edgeCharacter(after, "first"))
    )
      children.splice(i + 1, 1, ...referenced(after, "first"));
    if (
      before?.type === "text" &&
      PUNCTUATION.test(innerEdgeCharacter(span, "first")) &&
      WORD.test(edgeCharacter(before, "last"))
    ) {
      const parts = referenced(before, "last");
      children.splice(i - 1, 1, ...parts);
      i += parts.length - 1;
    }
  }
}

/**
 * Bold directly inside bold, or italic inside italic, at its end and with
 * text right after it: `*foo *bar**Pasted`. The two closing runs are one,
 * `**`, which can open as well as close there, and the rule of 3 then
 * keeps it from closing a single `*`: both spans read back as text with
 * asterisks in it - text pasted or typed after a nested span. The inner
 * span is written with underscores, `*foo _bar_*`, so the runs stay
 * apart, and encodeAroundAttention writes the word's letter after it as a
 * character reference. The same at the start, with text right before.
 * Not where the underscores would stand against a word inside the span:
 * they don't open or close in a word.
 */
export function alternateNestedMarkers(node: Phrasing): void {
  if (!node.children) return;
  node.children.forEach(alternateNestedMarkers);
  const children = node.children;
  const outside = (child: Phrasing | undefined, end: "first" | "last") =>
    child !== undefined && /^\S$/u.test(edgeCharacter(child, end));
  const free = (child: Phrasing | undefined, end: "first" | "last") =>
    child === undefined || !/^[\p{L}\p{N}]$/u.test(edgeCharacter(child, end));
  children.forEach((span, i) => {
    const inner = span.children ?? [];
    if (!ATTENTION.has(span.type) || !inner.length) return;
    const last = inner[inner.length - 1];
    if (
      last.type === span.type &&
      outside(children[i + 1], "first") &&
      free(inner[inner.length - 2], "last")
    )
      last.marker = "_";
    const first = inner[0];
    if (
      first.type === span.type &&
      outside(children[i - 1], "last") &&
      free(inner[1], "first")
    )
      first.marker = "_";
  });
}

/**
 * Italic written `_text_` (md-span-schema.ts) right against a letter or a
 * digit, `a_text_`: underscores don't open or close inside a word, so it
 * read back as text with underscores in it - a word typed against the
 * italic. Written with asterisks there, which do.
 */
export function underscoresAtWordEdges(node: Phrasing): void {
  if (!node.children) return;
  node.children.forEach(underscoresAtWordEdges);
  const word = /^[\p{L}\p{N}]$/u;
  node.children.forEach((span, i, children) => {
    if (span.type !== "emphasis" || span.marker !== "_") return;
    const before = children[i - 1];
    const after = children[i + 1];
    if (
      (before && word.test(edgeCharacter(before, "last"))) ||
      (after && word.test(edgeCharacter(after, "first")))
    )
      delete span.marker;
  });
}
