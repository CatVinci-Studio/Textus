// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentConversation } from "../chat/useAgentConversation";
vi.mock("../chat/chat-history", () => ({
  useChatHistory: () => [
    {
      id: "saved",
      docPath: "/docs/a.md",
      title: "Saved task",
      turns: [],
      updatedAt: 1,
    },
  ],
}));
import { AgentWorkspace } from "./AgentWorkspace";
afterEach(cleanup);
it("restores a saved task but protects pending media from history switches", () => {
  const restore = vi.fn();
  const conversation = {
    history: [],
    streaming: null,
    conversationId: "current",
    busy: false,
    restore,
    reset: vi.fn(),
    stop: vi.fn(),
  } as unknown as AgentConversation;
  const props = {
    language: "en",
    title: "a.md",
    documentPath: "/docs/a.md",
    draft: null,
    preview: "",
    conflict: false,
    conversation,
    onEditor: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    children: null,
  };
  const { rerender } = render(<AgentWorkspace {...props} pendingMedia />);
  fireEvent.click(screen.getByRole("button", { name: "Saved task" }));
  expect(restore).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  rerender(<AgentWorkspace {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Saved task" }));
  expect(restore).toHaveBeenCalledWith("saved", []);
});
