import { describe, expect, it } from "vitest";
import { aiRoot } from "./ai-root";
import { setOpenFolder } from "../../platform/open-folder";

describe("the AI's project folder", () => {
  it("is the user's pick, else the folder open in this window", () => {
    setOpenFolder("/notes");
    expect(aiRoot({ agentWorkspaceRoot: "" })).toBe("/notes");
    expect(aiRoot({ agentWorkspaceRoot: "/research" })).toBe("/research");
    setOpenFolder(null);
    expect(aiRoot({ agentWorkspaceRoot: "" })).toBeNull();
  });

  it("is none for an Android folder its tools can't read", () => {
    setOpenFolder("content://x/tree/primary%3ANotes/document/primary%3ANotes");
    expect(aiRoot({ agentWorkspaceRoot: "" })).toBeNull();
    setOpenFolder(null);
  });
});
