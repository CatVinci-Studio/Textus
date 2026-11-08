import { describe, expect, it } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { toolActivityText } from "./tool-activity";
import { chatLabels } from "./chat-labels";

describe("a tool call in the conversation", () => {
  const labels = chatLabels(resolveStrings("en"), "en");

  it("says what the tool is doing, with its argument", () => {
    expect(
      toolActivityText("read_file", '{"path":"notes.md"}', labels),
    ).toContain("notes.md");
  });

  it("names an MCP server's tool by the name the model called it", () => {
    expect(toolActivityText("mcp_memory_create_entities", "{}", labels)).toBe(
      "Using memory_create_entities",
    );
  });

  it("words Research's steps as the chat words a tool call", () => {
    expect(toolActivityText("add_note", '{"claim":"Roofs cool"}', labels)).toBe(
      "Noted: Roofs cool",
    );
    expect(
      toolActivityText("web_search", '{"queries":["green roofs"]}', labels),
    ).toContain("green roofs");
    expect(
      toolActivityText("delegate_task", '{"question":"Gauge A?"}', labels),
    ).toBe("Handing over: Gauge A?");
  });
});
