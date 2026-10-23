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
    expect(initialMode("write")).toBe("write");
  });

  it("reads 1.2.0's Revise, kept as the last pick, as Write", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode: "revise", under: "review" }),
    );
    expect(initialMode("review")).toBe("write");
  });

  it("ignores a pick it can't read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode: "destroy", under: "review" }),
    );
    expect(initialMode("review")).toBe("review");
    localStorage.setItem(KEY, JSON.stringify({ mode: "edit", under: "ask" }));
    expect(initialMode("review")).toBe("review");
    localStorage.setItem(KEY, "not json");
    expect(initialMode("write")).toBe("write");
  });
});
