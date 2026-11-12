// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestLocalStorage } from "../dev/test-local-storage";

const patched: Record<string, unknown>[] = [];
vi.mock("./boot", () => ({
  readBoot: () => ({ uiState: { webSearch: false } }),
}));
vi.mock("../platform/ipc", () => ({
  storage: {
    uiStateGet: () => new Promise(() => {}),
    uiStatePatch: (patch: Record<string, unknown>) => {
      patched.push(patch);
      return Promise.resolve();
    },
  },
}));

const { getUiState, resetUiStateForTests } = await import("./ui-state");

describe("ui-state", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => {
    localStorage.clear();
    patched.length = 0;
    resetUiStateForTests();
  });

  it("carries what was kept in localStorage into the file once, and lets it go", () => {
    localStorage.setItem("textus-agent-deep-thinking", "1");
    localStorage.setItem("textus-agent-web-search", "1");
    expect(getUiState("deepThinking")).toBe(true);
    // The file's own value wins over the old one.
    expect(getUiState("webSearch")).toBe(false);
    expect(patched).toEqual([{ deepThinking: true }]);
    expect(localStorage.getItem("textus-agent-deep-thinking")).toBeNull();
  });
});
