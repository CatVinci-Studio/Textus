/** How many changes each open document still has to decide - the writer's
 *  own and Textus AI's - by path, as its editor reports them, so closing it
 *  can say they are kept. */
const counts = new Map<string, { own: number; ai: number }>();

export function reportUndecided(
  path: string,
  from: "own" | "ai",
  count: number,
): void {
  const now = counts.get(path) ?? { own: 0, ai: 0 };
  counts.set(path, { ...now, [from]: count });
}

export function undecidedIn(path: string): number {
  const now = counts.get(path);
  return now ? now.own + now.ai : 0;
}
