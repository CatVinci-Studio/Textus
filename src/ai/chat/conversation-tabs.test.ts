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
  const asked: [string | null, string | undefined][] = [];
  setConversationOpener((from, id) => {
    asked.push([from, id]);
    return true;
  });
  expect(openConversationTab("past")).toBe(true);
  expect(asked).toEqual([[null, "past"]]);
});
