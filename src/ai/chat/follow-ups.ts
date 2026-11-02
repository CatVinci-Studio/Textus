/** As many follow-ups as fit as buttons over the message box. */
const MOST = 3;

/**
 * The suggested next messages to offer, from what the backend returned
 * (`suggest_next_message`, already cleaned there): text only, no blanks or
 * repeats, at most three. Anything else - an old build, a shim - is none.
 */
export function followUps(answer: unknown): string[] {
  if (!Array.isArray(answer)) return [];
  const found: string[] = [];
  for (const item of answer) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    const key = text.toLowerCase();
    if (!text || found.some((f) => f.toLowerCase() === key)) continue;
    found.push(text);
    if (found.length === MOST) break;
  }
  return found;
}
