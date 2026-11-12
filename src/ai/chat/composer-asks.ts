/**
 * Text asked into the AI's composer from elsewhere ("Ask about it", a
 * plugin's "Edit with AI"): the conversation's composer takes it when it
 * is up, waiting for it while the AI tab opens.
 */

interface Taker {
  take: (text: string) => void;
  /** On screen: an AI tab kept loaded behind another isn't asked. */
  shown: () => boolean;
}

let waiting: string | null = null;
const takers: Taker[] = [];

export function askInComposer(text: string): void {
  const taker =
    [...takers].reverse().find((t) => t.shown()) ?? takers.at(-1);
  if (taker) taker.take(text);
  else waiting = text;
}

/** For a conversation's composer: `take` gets each ask, one waiting first. */
export function takeComposerAsks(
  take: (text: string) => void,
  shown: () => boolean = () => true,
): () => void {
  const taker = { take, shown };
  takers.push(taker);
  if (waiting !== null) {
    const text = waiting;
    waiting = null;
    take(text);
  }
  return () => {
    const at = takers.indexOf(taker);
    if (at >= 0) takers.splice(at, 1);
  };
}
