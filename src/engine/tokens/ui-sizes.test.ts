import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHONE_SCALES } from "./chrome-scale";
import { UI_SIZE_NAMES } from "../../prefs/settings-values";

const css = readFileSync(join(__dirname, "ui-sizes.css"), "utf8");

/** A token in the block whose selector is exactly `selector`. */
function token(selector: string, name: string): string | undefined {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return undefined;
  const block = css.slice(at, css.indexOf("}", at));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1];
}

const phone = (size: string) =>
  size === "medium"
    ? `:root[data-window-chrome="mobile"]`
    : `:root[data-window-chrome="mobile"][data-ui-size="${size}"]`;
const px = (value: string | undefined) => Number.parseFloat(value ?? "");

describe("the phone's Interface Size steps", () => {
  it("has the stylesheet's chrome scale in script for each step", () => {
    for (const size of UI_SIZE_NAMES) {
      const written =
        size === "large" ? "1" : token(phone(size), "--chrome-scale");
      expect(Number(written), size).toBe(PHONE_SCALES[size]);
    }
  });

  it("grows its body text at every step, by iOS's sizes", () => {
    const body = UI_SIZE_NAMES.map((size) =>
      size === "large" ? 20 : px(token(phone(size), "--text-body")),
    );
    expect(body).toEqual([15, 17, 20, 24, 28]);
  });
});

describe("a tablet's two larger steps", () => {
  it("keeps the bar at Large's row", () => {
    for (const size of ["xlarge", "xxlarge"])
      expect(
        token(
          `:root[data-ui-size="${size}"]:not([data-window-chrome="mobile"])`,
          "--window-bar-row",
        ),
      ).toBe("48px");
  });
});
