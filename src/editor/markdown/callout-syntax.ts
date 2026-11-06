// One rule for callouts, read by the editor and the Pandoc export alike:
// GitHub's five alerts plus Obsidian's callouts, with a title and a fold.

/** The colour and icon a callout draws with. */
export type CalloutKind =
  "note" | "tip" | "important" | "warning" | "caution" | "quote";

/** GitHub's own five, whose label is translated. */
export const GITHUB_ALERTS = [
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
] as const;
export type AlertType = (typeof GITHUB_ALERTS)[number];

// Obsidian's types and aliases; "important" and "caution" keep GitHub's
// meaning, and a type not listed draws as a note.
const KINDS: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  todo: "note",
  abstract: "note",
  summary: "note",
  tldr: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  important: "important",
  example: "important",
  warning: "warning",
  attention: "warning",
  question: "warning",
  help: "warning",
  faq: "warning",
  caution: "caution",
  failure: "caution",
  fail: "caution",
  missing: "caution",
  danger: "caution",
  error: "caution",
  bug: "caution",
  quote: "quote",
  cite: "quote",
};

const MARKER = /^\[!([^\]\s]+)\]([-+]?)/;

export interface CalloutLine {
  /** The type as written: "NOTE", "faq", "my-type". */
  name: string;
  kind: CalloutKind;
  /** "-" starts folded, "+" open and foldable, "" not foldable. */
  fold: "" | "-" | "+";
  /** The words after the marker on its line, trimmed; "" for none. */
  title: string;
  /** The marker's own length, `[!faq]-`. */
  length: number;
}

/** A callout's first line (after the quote's `>`), or null when it isn't
 *  one: the marker must open the line and be followed by a space or nothing. */
export function readCalloutLine(line: string): CalloutLine | null {
  const match = MARKER.exec(line);
  if (!match) return null;
  const rest = line.slice(match[0].length);
  if (rest && !/^[ \t]/.test(rest)) return null;
  return {
    name: match[1],
    kind: KINDS[match[1].toLowerCase()] ?? "note",
    fold: match[2] as CalloutLine["fold"],
    title: rest.trim(),
    length: match[0].length,
  };
}

/** What a callout's heading reads: its own title, else GitHub's translated
 *  label, else its type capitalised as Obsidian shows it. */
export function calloutHeading(
  callout: CalloutLine,
  labelOf: (type: AlertType) => string,
): string {
  if (callout.title) return callout.title;
  const upper = callout.name.toUpperCase();
  if ((GITHUB_ALERTS as readonly string[]).includes(upper))
    return labelOf(upper as AlertType);
  return callout.name.charAt(0).toUpperCase() + callout.name.slice(1);
}
