import { describe, expect, it, vi } from "vitest";
import { addFromTabRow } from "./ai-tabs";

const aiTab = (conversation?: string) => ({
  view: {
    kind: "page",
    view: "ai",
    state: conversation ? { conversation } : null,
  },
});

describe("addFromTabRow", () => {
  it("starts a new conversation beside an AI tab, not a document", () => {
    const addDocument = vi.fn();
    const startConversation = vi.fn();
    addFromTabRow(aiTab("c1"), addDocument, startConversation);
    expect(startConversation).toHaveBeenCalledWith("c1", addDocument);
    expect(addDocument).not.toHaveBeenCalled();
  });

  it("asks from the draft when the AI tab has no conversation yet", () => {
    const startConversation = vi.fn();
    addFromTabRow(aiTab(), vi.fn(), startConversation);
    expect(startConversation.mock.calls[0][0]).toBeTypeOf("string");
  });

  it("adds a document over a document or another page", () => {
    for (const front of [
      {},
      undefined,
      { view: { kind: "page", view: "settings" } },
    ]) {
      const addDocument = vi.fn();
      const startConversation = vi.fn();
      addFromTabRow(front, addDocument, startConversation);
      expect(addDocument).toHaveBeenCalledOnce();
      expect(startConversation).not.toHaveBeenCalled();
    }
  });
});
