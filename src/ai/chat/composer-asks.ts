/**
 * Text asked into the AI's composer from elsewhere ("Ask about it", a
 * plugin's "Edit with AI"): the conversation's composer takes it when it
 * is up, waiting for it while the AI tab opens.
 */

let waiting: string | null = null;
const takers: ((text: string) => void)[] = [];

export function askInComposer(text: string): void {
  const take = takers.at(-1);
  if (take) take(text);
  else waiting = text;
}

/** For a conversation's composer: `take` gets each ask, one waiting first. */
export function takeComposerAsks(take: (text: string) => void): () => void {
  takers.push(take);
  if (waiting !== null) {
    const text = waiting;
    waiting = null;
    take(text);
  }
  return () => {
    const at = takers.indexOf(take);
    if (at >= 0) takers.splice(at, 1);
  };
}
