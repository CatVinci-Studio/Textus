// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fitGutter } from "./gutter-fit";

const ROW = 24;

/** A code block of `text` drawn `rows` rows tall, and a gutter numbering
 *  its lines. `tops` gives where each line's first character is reported. */
function block(text: string, rows: number, tops: number[]) {
  const code = document.createElement("code");
  code.textContent = text;
  code.style.height = `${rows * ROW}px`;
  code.style.lineHeight = `${ROW}px`;
  code.getBoundingClientRect = () =>
    ({ top: 0, bottom: rows * ROW, height: rows * ROW }) as DOMRect;
  const gutter = document.createElement("span");
  for (let i = 0; i < text.split("\n").length; i++)
    gutter.appendChild(document.createElement("span"));
  let measured = 0;
  const prototype = Range.prototype as unknown as Record<string, unknown>;
  prototype.getClientRects = () => [{ top: tops[measured++] }];
  prototype.getBoundingClientRect = () => ({ top: 0 });
  return { code, gutter, measured: () => measured };
}

const heights = (gutter: HTMLElement) =>
  Array.from(gutter.children, (n) => (n as HTMLElement).style.height);

afterEach(() => {
  const prototype = Range.prototype as unknown as Record<string, unknown>;
  delete prototype.getClientRects;
  delete prototype.getBoundingClientRect;
});

describe("fitGutter", () => {
  it("gives each line a row when none wraps, without measuring", () => {
    // WebKitGTK reported the indented and empty lines a row too high (#513).
    const { code, gutter, measured } = block(
      "fn main() {\n\n    x\n}",
      4,
      [0, 0, 24, 72],
    );
    fitGutter(gutter, code);
    expect(heights(gutter)).toEqual(["24px", "24px", "24px", "24px"]);
    expect(measured()).toBe(0);
  });

  it("sizes a wrapping line's number to its rows", () => {
    const { code, gutter } = block("short\nlong line\nend", 4, [0, 24, 72]);
    fitGutter(gutter, code);
    expect(heights(gutter)).toEqual(["24px", "48px", "24px"]);
  });

  it("never draws a line's number less than a row tall", () => {
    // The second line's start reported on the first line's row.
    const { code, gutter } = block("short\n    long line\nend", 4, [0, 0, 72]);
    fitGutter(gutter, code);
    expect(heights(gutter)).toEqual(["24px", "48px", "24px"]);
  });
});
