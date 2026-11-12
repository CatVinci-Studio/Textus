/** How many changes each open document still has to decide - the writer's
 *  own and Textus AI's - by path, as its editor reports them, so closing it
 *  can say they are kept. */
const counts = new Map<string, { own: number; ai: number }>();

export function reportUndecided(
  path: string,
  from: "own" | "ai",
  count: number,
): void {
  const now = { ...(counts.get(path) ?? { own: 0, ai: 0 }), [from]: count };
  // None left to decide: nothing kept for it.
  if (now.own + now.ai === 0) counts.delete(path);
  else counts.set(path, now);
}

/** Its document closed: the next one opened there reports afresh. */
export function forgetUndecided(path: string): void {
  counts.delete(path);
}

export function undecidedIn(path: string): number {
  const now = counts.get(path);
  return now ? now.own + now.ai : 0;
}
