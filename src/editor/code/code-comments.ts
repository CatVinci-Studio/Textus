import { refractor } from "refractor";

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

// For a language refractor doesn't bundle: the common comment forms. `#`
// alone isn't one, or `#fff` in CSS would be.
const FALLBACK_COMMENT =
  /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|<!--[\s\S]*?(?:-->|(?![\s\S]))|(?<=^|[ \t])(?:\/\/|#(?=[ \t])|--(?=[ \t]))[^\n]*/gm;

/**
 * The [from, to) offsets of the comments in a code block's text, by the
 * highlighter's tokens or by the common forms.
 */
export function commentRanges(
  text: string,
  language: string | null,
): [number, number][] {
  const ranges: [number, number][] = [];
  if (!language || !refractor.registered(language)) {
    for (const match of text.matchAll(FALLBACK_COMMENT))
      ranges.push([match.index, match.index + match[0].length]);
    return ranges;
  }
  let at = 0;
  const walk = (node: HastNode) => {
    if (node.type === "text") {
      at += node.value?.length ?? 0;
      return;
    }
    const start = at;
    node.children?.forEach(walk);
    if (node.properties?.className?.includes("comment"))
      ranges.push([start, at]);
  };
  try {
    walk(refractor.highlight(text, language) as HastNode);
  } catch {
    // Left without: a swatch too many beats none in the code.
  }
  return ranges;
}
