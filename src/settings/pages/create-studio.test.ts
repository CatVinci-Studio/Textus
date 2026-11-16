import { describe, expect, it } from "vitest";
import { createMessage } from "./create-studio";
import { resolveSkillMessage } from "../../ai/chat/proposal";

describe("Settings › Extensions › Create", () => {
  it("starts with the kind's skill loaded, the request after it", () => {
    const message = resolveSkillMessage(
      createMessage("plugin", "  a to-do list in the sidebar "),
      [{ name: "plugin", description: "", prompt: "Make a plugin." } as never],
    );
    expect(message).toContain("Make a plugin.");
    expect(message.endsWith("\n\na to-do list in the sidebar")).toBe(true);
  });
});
