// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  DRAFT,
  openConversations,
  reorderConversation,
} from "./conversation-scope";

it("never keeps the unsent draft among a folder's open conversations", () => {
  reorderConversation("/notes", "c1", 0);
  // Dragging the lone draft tab in a popped-out chat.
  reorderConversation("/notes", DRAFT, 0);
  expect(openConversations("/notes")).toEqual(["c1"]);
});
