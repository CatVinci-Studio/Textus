// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSER_MODES,
  fitMode,
  initialMode,
  rememberMode,
} from "./last-mode";
import { installTestLocalStorage } from "../../dev/test-local-storage";

const KEY = "textus-agent-last-mode";

describe("the modes each composer offers", () => {
  it("Quick Ask offers Revise first, then Review, and no Write", () => {
    expect(COMPOSER_MODES.quick).toEqual(["revise", "review"]);
    expect(COMPOSER_MODES.full).toEqual(["write", "review", "revise"]);
  });

  it("a mode the composer doesn't offer starts on its first", () => {
    expect(fitMode("write", COMPOSER_MODES.quick)).toBe("revise");
    expect(fitMode("review", COMPOSER_MODES.quick)).toBe("review");
    expect(fitMode("write", COMPOSER_MODES.full)).toBe("write");
  });
});

describe("the mode a conversation starts in", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("carries the last pick over while the default is unchanged", () => {
    rememberMode("write", "review");
    expect(initialMode("review")).toBe("write");
    expect(initialMode("revise")).toBe("revise");
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
