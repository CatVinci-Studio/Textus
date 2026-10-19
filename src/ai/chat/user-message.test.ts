import { describe, expect, it } from "vitest";
import {
  attachedFileBlock,
  parseUserMessage,
  selectedTextBlock,
  skillBlock,
  userMessageBody,
} from "./user-message";

describe("parseUserMessage", () => {
  it("folds a task brief out of the body", () => {
    expect(
      parseUserMessage(
        "【自动写作 1/3】缘起\n\n<task-brief>\n请写第 1 节\n</task-brief>",
      ).body,
    ).toBe("【自动写作 1/3】缘起");
  });

  it("leaves a plain message alone", () => {
    expect(parseUserMessage("rewrite this")).toEqual({
      body: "rewrite this",
      selection: null,
      attachments: [],
    });
  });

  it("lifts the selection out of the body", () => {
    const parsed = parseUserMessage(
      "<selected-text>\n## Heading\n\nBody\n</selected-text>\n\nmake it shorter",
    );
    expect(parsed.body).toBe("make it shorter");
    expect(parsed.selection).toBe("## Heading\n\nBody");
  });

  it("collects attachment names and drops their content", () => {
    const parsed = parseUserMessage(
      '<attached-file name="notes.md">\nlots of text\n</attached-file>\n\n' +
        '<attached-file name="spec.md">\nmore\n</attached-file>\n\nsummarize these',
    );
    expect(parsed.attachments).toEqual(["notes.md", "spec.md"]);
    expect(parsed.body).toBe("summarize these");
  });

  it("handles a message carrying both", () => {
    const parsed = parseUserMessage(
      '<attached-file name="a.md">\nx\n</attached-file>\n\n' +
        "<selected-text>\npicked\n</selected-text>\n\ndo it",
    );
    expect(parsed).toEqual({
      body: "do it",
      selection: "picked",
      attachments: ["a.md"],
    });
  });

  it("keeps an empty body when the message was only context", () => {
    const parsed = parseUserMessage("<selected-text>\nonly\n</selected-text>");
    expect(parsed.body).toBe("");
    expect(parsed.selection).toBe("only");
  });
});

describe("the wire format's writer and reader agree", () => {
  // The whole reason writing moved into this module: three places used to
  // hand-roll the same tags, and every way of drifting apart is silent.
  it("round-trips a message built from the block writers", () => {
    const text = [
      attachedFileBlock("notes.md", "reference material"),
      selectedTextBlock("the **selected** passage"),
      "tighten this",
    ].join("\n\n");

    const parsed = parseUserMessage(text);
    expect(parsed.attachments).toEqual(["notes.md"]);
    expect(parsed.selection).toBe("the **selected** passage");
    expect(parsed.body).toBe("tighten this");
  });

  it("shows a skill the user called as the /name they typed", () => {
    const text = `${selectedTextBlock("y")}\n\n${skillBlock("tighten", "Cut filler.\nKeep every claim.")}\n\nthe Method paragraph`;
    expect(parseUserMessage(text)).toEqual({
      body: "/tighten the Method paragraph",
      selection: "y",
      attachments: [],
    });
    expect(userMessageBody(skillBlock("tighten", "Cut filler."))).toBe(
      "/tighten",
    );
  });

  it("shows an alias the way it was typed", () => {
    expect(
      userMessageBody(
        `${skillBlock("continue-story", "", "/续写")}\n\n林晚走进书店`,
      ),
    ).toBe("/续写 林晚走进书店");
    expect(userMessageBody(skillBlock("tighten", "Cut.", '/"odd"<name>'))).toBe(
      '/"odd"<name>',
    );
    // The canonical name typed as-is carries no `typed`.
    expect(skillBlock("tighten", "Cut.", "/tighten")).toBe(
      '<skill name="tighten">\nCut.\n</skill>',
    );
  });

  it("strips every block for a display-only body", () => {
    const text = `${attachedFileBlock("a.md", "x")}\n\n${selectedTextBlock("y")}\n\nwhat is this?`;
    expect(userMessageBody(text)).toBe("what is this?");
  });
});
