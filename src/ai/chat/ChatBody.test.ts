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
});
