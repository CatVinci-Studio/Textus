/** A change as a chip shows it (MarginCards): what goes and what comes,
 *  with a few characters either side - a sentence with one comma changed
 *  read as the same sentence twice. */
export interface Glimpse {
  /** Before the change; "" at the sentence's start. */
  lead: string;
  removed: string;
  added: string;
  /** After it; "" at the sentence's end. */
  tail: string;
  /** Whether `lead` and `tail` were cut short. */
  cutLead: boolean;
  cutTail: boolean;
  /** A small change in a sentence that otherwise stays - not a rewrite,
   *  which a chip shows as its text. */
  partial: boolean;
}

/** How many characters of the unchanged text either side a chip keeps. */
const CONTEXT = 6;

/** The changed stretch of `before` -> `after`: their shared start and end
 *  set aside, by character (not UTF-16 unit, so no emoji is split). */
export function changeGlimpse(before: string, after: string): Glimpse {
  const a = Array.from(before.trim());
  const b = Array.from(after.trim());
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const lead = a.slice(Math.max(0, start - CONTEXT), start).join("");
  const tail = a.slice(a.length - end, a.length - end + CONTEXT).join("");
  return {
    lead,
    removed: a.slice(start, a.length - end).join(""),
    added: b.slice(start, b.length - end).join(""),
    tail,
    cutLead: start > CONTEXT,
    cutTail: end > CONTEXT,
    partial:
      start + end >= 2 && start + end >= Math.max(a.length, b.length) / 2,
  };
}
