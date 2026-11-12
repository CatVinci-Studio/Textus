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

// Codex's (codex-acp 2.6): "Workspace access" says "ask" but edits unasked.
const codex = {
  id: "mode",
  category: "mode",
  type: "select",
  currentValue: "agent",
  options: [
    {
      value: "read-only",
      name: "Read-only",
      description: "Requires approval to edit files and access the internet.",
    },
    {
      value: "workspace-write",
      name: "Workspace access",
      description:
        "Edit workspace files; ask before writing outside the workspace or accessing the network.",
    },
    {
      value: "agent",
      name: "Auto review",
      description: "Only ask for actions detected as potentially unsafe",
    },
    {
      value: "agent-full-access",
      name: "Full access",
      description:
        "Unrestricted access to the internet and any file on your computer",
    },
  ],
};
// OpenCode's (1.19): no mode that asks.
const opencode = {
  id: "mode",
  category: "mode",
  type: "select",
  currentValue: "build",
  options: [
    { value: "build", name: "build", description: "The default agent." },
    { value: "plan", name: "plan", description: "Disallows all edit tools." },
  ],
};

describe("the mode an agent starts in", () => {
  it("is the one that asks, whatever the agent's own settings chose", () => {
    expect(askingMode(claude)).toEqual({ configId: "mode", value: "default" });
    expect(askingMode([codex])).toEqual({
      configId: "mode",
      value: "read-only",
    });
    expect(askingMode([opencode])).toBeNull();
  });

  it("is left alone when it asks already, or the agent has no modes", () => {
    expect(askingMode([{ ...claude[0], currentValue: "default" }])).toBeNull();
    expect(askingMode([claude[1]])).toBeNull();
    expect(askingMode(undefined)).toBeNull();
  });
});
