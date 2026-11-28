import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The tour dims the window as a dialog's backdrop does: it fades in as one,
// and its ring fades in where a step first rings something.
const css = readFileSync(new URL("./TourLayer.css", import.meta.url), "utf8");

/** The declarations of the rule for exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
}

describe("the tour's entrance", () => {
  it.each([".tour-layer", ".tour-ring"])("%s fades in", (selector) => {
    expect(rule(selector)).toMatch(/animation:\s*motion-fade-in/);
  });
});
