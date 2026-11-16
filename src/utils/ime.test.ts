// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterComposition, isImeKeydown } from "./ime";

describe("isImeKeydown", () => {
  it("knows a composing key by its flag or by WebKit's keyCode 229", () => {
    expect(
      isImeKeydown(new KeyboardEvent("keydown", { isComposing: true })),
    ).toBe(true);
    expect(isImeKeydown(new KeyboardEvent("keydown", { keyCode: 229 }))).toBe(
      true,
    );
    expect(isImeKeydown(new KeyboardEvent("keydown", { key: "a" }))).toBe(
      false,
    );
  });

  it("reads a React event's native one", () => {
    const nativeEvent = new KeyboardEvent("keydown", { keyCode: 229 });
    expect(isImeKeydown({ nativeEvent })).toBe(true);
  });
});

describe("afterComposition", () => {
  it("waits for a composition, but not for one whose end was lost with the focus", () => {
    let ran = 0;
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    afterComposition(() => ran++);
    expect(ran).toBe(0);
    window.dispatchEvent(new FocusEvent("blur"));
    afterComposition(() => ran++);
    expect(ran).toBe(1);
  });
});
