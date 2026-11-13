import { describe, expect, it } from "vitest";
import { scaleLengths, scaleStylesheet } from "./scale-lengths";

describe("a plugin page's lengths", () => {
  // The same cases as vite.chrome-scale.test.ts, each length at Medium's.
  it("are scaled as the build scales the app's, from Medium's pixels", () => {
    const scaled = (n: number) => `calc(${n}px * var(--chrome-scale, 1))`;
    expect(scaleLengths("4px 8px")).toBe(`${scaled(4)} ${scaled(8)}`);
    expect(scaleLengths("12px 14px 28px 3px")).toBe(
      `${scaled(14)} ${scaled(16)} ${scaled(30)} ${scaled(3)}`,
    );
    expect(scaleLengths("1px solid")).toBe("1px solid");
    expect(scaleLengths("999px")).toBe("999px");
    expect(scaleLengths("calc(100% - 8px)")).toBe(`calc(100% - ${scaled(8)})`);
    expect(scaleLengths("calc(2px * var(--chrome-scale))")).toBe(
      "calc(2px * var(--chrome-scale))",
    );
  });

  it("in a stylesheet: declarations, not media queries or comments", () => {
    expect(
      scaleStylesheet(
        "/* 40px */ .a { padding: 8px 12px; border: 1px solid } @media (max-width: 600px) { .b { --gap: 6px } }",
      ),
    ).toBe(
      " .a { padding: calc(8px * var(--chrome-scale, 1)) calc(14px * var(--chrome-scale, 1)); border: 1px solid } @media (max-width: 600px) { .b { --gap: calc(6px * var(--chrome-scale, 1)) } }",
    );
  });
});
