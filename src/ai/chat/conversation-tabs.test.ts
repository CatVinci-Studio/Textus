// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { conversationScope } from "./conversation-scope";
import {
  openConversationTab,
  setConversationOpener,
} from "./conversation-tabs";

afterEach(() => setConversationOpener(null));

it("keeps a conversation in the window's folder with no saved document in front", () => {
  expect(conversationScope(null, "/notes")).toBe("/notes");
  expect(conversationScope("/a.md", null)).toBe("/a.md");
  expect(conversationScope(null, null)).toBeNull();
});

it("opens a reopened conversation in a tab of its own where there are tabs", () => {
  expect(openConversationTab("past")).toBe(false);
  const asked: [
    string | null,
    string | undefined,
    string | null | undefined,
  ][] = [];
  setConversationOpener((from, id, docPath) => {
    asked.push([from, id, docPath]);
    return true;
  });
  expect(openConversationTab("past")).toBe(true);
  // Reopened from History: with the document it belongs to, whose
  // conversations it joins where they are kept per document.
  expect(openConversationTab("b's", undefined, "/b.md")).toBe(true);
  expect(asked).toEqual([
    [null, "past", undefined],
    [null, "b's", "/b.md"],
  ]);
});
