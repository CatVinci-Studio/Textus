// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initialMode, rememberMode } from "./last-mode";
import { installTestLocalStorage } from "../../dev/test-local-storage";

const KEY = "textus-agent-last-mode";

describe("the mode a conversation starts in", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("carries the last pick over while the default is unchanged", () => {
    rememberMode("write", "review");
    expect(initialMode("review")).toBe("write");
    expect(initialMode("revise")).toBe("revise");
  });

  it("reads a pick kept under 1.0's names as today's", () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: "edit", under: "ask" }));
    expect(initialMode("review")).toBe("revise");
    localStorage.setItem(KEY, JSON.stringify({ mode: "plan", under: "ask" }));
    expect(initialMode("review")).toBe("review");
  });

  it("ignores a pick it can't read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode: "destroy", under: "review" }),
    );
    expect(initialMode("review")).toBe("review");
    localStorage.setItem(KEY, "not json");
    expect(initialMode("write")).toBe("write");
  });
});
