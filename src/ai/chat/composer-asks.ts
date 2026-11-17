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

let waiting: { text: string; taken: () => void } | null = null;
const takers: Taker[] = [];

/** Resolves once a composer has the text: at once, or when the AI tab
 *  being opened for it is up. */
export function askInComposer(text: string): Promise<void> {
  const taker = [...takers].reverse().find((t) => t.shown()) ?? takers.at(-1);
  if (taker) {
    taker.take(text);
    return Promise.resolve();
  }
  // An ask still waiting gives way to this one.
  waiting?.taken();
  return new Promise((taken) => (waiting = { text, taken }));
}

/** For a conversation's composer: `take` gets each ask, one waiting first. */
export function takeComposerAsks(
  take: (text: string) => void,
  shown: () => boolean = () => true,
): () => void {
  const taker = { take, shown };
  takers.push(taker);
  if (waiting !== null) {
    const { text, taken } = waiting;
    waiting = null;
    take(text);
    taken();
  }
  return () => {
    const at = takers.indexOf(taker);
    if (at >= 0) takers.splice(at, 1);
  };
}
