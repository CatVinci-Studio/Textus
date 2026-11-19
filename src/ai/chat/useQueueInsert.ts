import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { QueuedMessage } from "./MessageQueue";
import type { AgentTurn } from "../types";

/**
 * A waiting message sent now: Textus AI's reply takes it at its next step
 * and goes on with it in mind; an external agent can't be told in the
 * middle of a reply, so it stops there and this message goes first.
 */
export function useQueueInsert(
  queue: QueuedMessage[],
  setQueue: Dispatch<SetStateAction<QueuedMessage[]>>,
  /** The reply in progress: its turns so far, and how to reach it. */
  reply: {
    turns: AgentTurn[] | undefined;
    steer: (message: string) => Promise<boolean>;
    stop: () => void;
  },
): (id: number) => void {
  const { turns, steer, stop } = reply;

  // Read by the reply: it shows there, so it leaves the list.
  useEffect(() => {
    const read = new Set(
      (turns ?? [])
        .slice(1)
        .flatMap((turn) => (turn.kind === "User" ? [turn.text] : [])),
    );
    if (queue.some((q) => q.inserted && read.has(q.message)))
      setQueue((now) =>
        now.filter((q) => !(q.inserted && read.has(q.message))),
      );
  }, [turns, queue, setQueue]);

  return (id) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    void steer(item.message).then((taken) => {
      if (taken) {
        setQueue((now) =>
          now.map((q) => (q.id === id ? { ...q, inserted: true } : q)),
        );
        return;
      }
      setQueue((now) => [item, ...now.filter((q) => q.id !== id)]);
      stop();
    });
  };
}
