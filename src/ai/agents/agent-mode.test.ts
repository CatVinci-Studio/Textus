import { describe, expect, it } from "vitest";
import { askingMode } from "./agent-mode";

// Claude Agent's modes, as its ACP adapter (0.104) offers them.
const claude = [
  {
    id: "mode",
    category: "mode",
    type: "select",
    currentValue: "bypassPermissions",
    options: [
      {
        value: "default",
        name: "Manual",
        description: "Always ask before making changes",
      },
      {
        value: "acceptEdits",
        name: "Accept edits",
        description: "Automatically accept all file edits",
      },
      { value: "plan", name: "Plan" },
      {
        value: "auto",
        name: "Auto",
        description: "Claude handles permission decisions",
      },
      {
        value: "bypassPermissions",
        name: "Bypass permissions",
        description: "Accepts all permissions",
      },
    ],
  },
  {
    id: "model",
    category: "model",
    type: "select",
    currentValue: "opus",
    options: [],
  },
];

describe("the mode an agent starts in", () => {
  it("is the one that asks, whatever the agent's own settings chose", () => {
    expect(askingMode(claude)).toEqual({ configId: "mode", value: "default" });
  });

  it("is left alone when it asks already, or the agent has no modes", () => {
    expect(askingMode([{ ...claude[0], currentValue: "default" }])).toBeNull();
    expect(askingMode([claude[1]])).toBeNull();
    expect(askingMode(undefined)).toBeNull();
  });
});
