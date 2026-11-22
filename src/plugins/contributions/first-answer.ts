/** How long a plugin has to answer before the next is asked. */
const ANSWER_MS = 1500;

/** The first string `ask` gets from the plugins in turn, each given
 *  ANSWER_MS; null when none has one. */
export async function firstAnswer<P>(
  providers: readonly P[],
  ask: (provider: P) => Promise<string | null>,
): Promise<string | null> {
  for (const provider of providers) {
    const answer = await Promise.race([
      ask(provider).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ANSWER_MS),
      ),
    ]);
    if (typeof answer === "string") return answer;
  }
  return null;
}
