import { describe, expect, it } from "vitest";
import { askingValue, readOptions, unaskingName } from "./agent-mode";

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

// DeepSeek's (dsh 0.2.2): its models in groups, each value a JSON string.
const deepseek = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: '["deepseek-official","deepseek-v4-flash"]',
  options: [
    {
      group: "deepseek-official",
      name: "DeepSeek",
      options: [
        { value: '["deepseek-official","deepseek-v4-flash"]', name: "flash" },
        { value: '["deepseek-official","deepseek-v4-pro"]', name: "pro" },
      ],
    },
  ],
};

describe("what an agent offers", () => {
  it("reads lists of two or more, a grouped one's choices in a row", () => {
    const [model] = readOptions([deepseek]);
    expect(model.choices.map((c) => c.name)).toEqual(["flash", "pro"]);
    expect(model.current).toBe(deepseek.currentValue);
    // One choice only, or not a list: nothing to pick.
    expect(readOptions([claude[1], { id: "x", type: "boolean" }])).toEqual([]);
    expect(readOptions(undefined)).toEqual([]);
  });
});

describe("the mode an agent starts in", () => {
  it("is the one that asks, whatever the agent's own settings chose", () => {
    expect(askingValue(readOptions(claude))).toBe("default");
    expect(askingValue(readOptions([codex]))).toBe("read-only");
    expect(askingValue(readOptions([opencode]))).toBeNull();
    expect(askingValue(readOptions([deepseek]))).toBeNull();
  });
});

describe("the chip by the agent's name", () => {
  it("names a mode that doesn't ask, only where the agent has one that does", () => {
    const claudeOptions = readOptions(claude);
    expect(unaskingName(claudeOptions, "default")).toBeNull();
    expect(unaskingName(claudeOptions, "bypassPermissions")).toBe(
      "Bypass permissions",
    );
    // OpenCode's build is how it works, not a choice to warn of.
    expect(unaskingName(readOptions([opencode]), "build")).toBeNull();
  });
});
