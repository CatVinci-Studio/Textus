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

  it("runs what waited once its composition ends, and never at a later one's", async () => {
    const ran: string[] = [];
    const settle = () => new Promise((done) => setTimeout(done, 5));
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    afterComposition(() => ran.push("first"));
    window.dispatchEvent(new CompositionEvent("compositionend"));
    await settle();
    expect(ran).toEqual(["first"]);
    // One whose composition was lost with the focus is dropped: the next
    // composition, in another place, must not carry it out.
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    afterComposition(() => ran.push("lost"));
    window.dispatchEvent(new FocusEvent("blur"));
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    window.dispatchEvent(new CompositionEvent("compositionend"));
    await settle();
    expect(ran).toEqual(["first"]);
  });
});
