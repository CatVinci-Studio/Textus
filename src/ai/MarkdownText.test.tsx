// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { InlineMarkdownText } from "./MarkdownText";

afterEach(cleanup);

describe("a review note's words", () => {
  it("show their bold and code, without the marks", () => {
    const { container } = render(
      <InlineMarkdownText text="Use **harbour** and `quay`." />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("harbour");
    expect(container.querySelector("code")?.textContent).toBe("quay");
    expect(container.textContent).toBe("Use harbour and quay.");
  });

  it("keep no markup a note could bring", () => {
    const { container } = render(
      <InlineMarkdownText text={'<img src=x onerror="alert(1)"> plain'} />,
    );
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(container.textContent).toContain("plain");
  });
});
