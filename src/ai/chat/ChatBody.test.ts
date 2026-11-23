// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RetryableSend } from "./conversation/conversation-types";
import type { QueuedMessage } from "./MessageQueue";
import { useMessageQueue } from "./useChatBodyState";
import { quickReplyExpands } from "./chat-body-types";
import type { AgentTurn } from "../types";

describe("quickReplyExpands", () => {
  const ask: AgentTurn = { kind: "User", text: "what is this?" };

  it("opens an answer-only reply in full", () => {
    expect(
      quickReplyExpands([ask, { kind: "Assistant", text: "It is a doc." }]),
    ).toBe(true);
  });

  it("keeps a reply that proposed edits compact", () => {
    const history = [
      ask,
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "old",
          text: "new",
        }),
      },
      { kind: "Assistant", text: "Done." },
    ] as AgentTurn[];
    expect(quickReplyExpands(history)).toBe(false);
  });

  it("judges only the newest exchange", () => {
    expect(
      quickReplyExpands([
        { kind: "User", text: "first" },
        { kind: "Assistant", text: "answer" },
        { kind: "User", text: "second" },
      ]),
    ).toBe(false);
  });
});

describe("useMessageQueue", () => {
  const failed = (): RetryableSend => ({
    document: { blocks: [] } as unknown as RetryableSend["document"],
    message: "hi",
    images: [],
    options: {} as RetryableSend["options"],
  });
  const queued = (id: number): QueuedMessage => ({
    id,
    typed: `m${id}`,
    message: `m${id}`,
    options: {} as QueuedMessage["options"],
  });

  it("pauses again for a second failure that reads like the first", () => {
    const sendNext = vi.fn(async () => undefined);
    const first = failed();
    const { result, rerender } = renderHook(
      ({ failure }: { failure: RetryableSend | null }) =>
        useMessageQueue(true, failure, "c1", sendNext, () => {}),
      { initialProps: { failure: first } },
    );
    act(() => result.current.setQueue([queued(1), queued(2)]));
    expect(result.current.queuePaused).toBe(true);
    act(() => result.current.goOn());
    expect(result.current.queuePaused).toBe(false);
    // The next send fails at once with the same text: no render in between
    // sees the failure cleared.
    rerender({ failure: failed() });
    expect(result.current.queuePaused).toBe(true);
  });

  type Props = { busy: boolean; failure: RetryableSend | null };
  const queueHook = (sendNext: () => Promise<undefined>, restore = vi.fn()) =>
    renderHook(
      ({ busy, failure }: Props) =>
        useMessageQueue(busy, failure, "c1", sendNext, restore),
      { initialProps: { busy: true, failure: null } as Props },
    );

  it("sends what waited once the reply before it is done, one at a time", async () => {
    let finish = () => {};
    const sendNext = vi.fn(
      () => new Promise<undefined>((r) => (finish = () => r(undefined))),
    );
    const { result, rerender } = queueHook(sendNext);
    act(() => result.current.setQueue([queued(1), queued(2)]));
    expect(sendNext).not.toHaveBeenCalled();
    rerender({ busy: false, failure: null });
    expect(sendNext).toHaveBeenCalledTimes(1);
    expect(sendNext).toHaveBeenLastCalledWith(queued(1));
    expect(result.current.queue.map((q) => q.id)).toEqual([2]);
    await act(async () => finish());
    expect(sendNext).toHaveBeenCalledTimes(2);
    expect(sendNext).toHaveBeenLastCalledWith(queued(2));
  });

  it("holds what waited while the reply before it failed", () => {
    const sendNext = vi.fn(async () => undefined);
    const { result, rerender } = queueHook(sendNext);
    act(() => result.current.setQueue([queued(1)]));
    rerender({ busy: false, failure: failed() });
    expect(result.current.queuePaused).toBe(true);
    expect(sendNext).not.toHaveBeenCalled();
    act(() => result.current.goOn());
    expect(sendNext).toHaveBeenCalledTimes(1);
  });

  it("gives what waited back to the box, joined, and empties the queue", () => {
    const restore = vi.fn();
    const { result } = queueHook(
      vi.fn(async () => undefined),
      restore,
    );
    act(() => result.current.setQueue([queued(1), queued(2)]));
    act(() => result.current.giveBack());
    expect(restore).toHaveBeenCalledWith("m1\n\nm2");
    expect(result.current.queue).toEqual([]);
  });
});
