import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_SIZE_NAMES } from "../../prefs/settings-values";

const sheet = (name: string) => readFileSync(join(__dirname, name), "utf8");

/** A token in the rule whose selector list starts with `selector`. */
function token(css: string, selector: string, name: string) {
  const at = [`${selector} {`, `${selector},`]
    .map((s) => css.indexOf(s))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined) return undefined;
  const block = css.slice(css.indexOf("{", at), css.indexOf("}", at));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1];
}

describe("the phone's Interface Size steps", () => {
  const phone = sheet("ui-sizes-phone.css");
  const rule = (size: string) =>
    size === "medium"
      ? `:root[data-window-chrome="mobile"]`
      : `:root[data-window-chrome="mobile"][data-ui-size="${size}"]`;

  it("grows its body text and its lengths at every step, by iOS's sizes", () => {
    const body = UI_SIZE_NAMES.map((size) =>
      Number.parseFloat(token(phone, rule(size), "--text-body") ?? ""),
    );
    expect(body).toEqual([15, 17, 20, 24, 28]);
    const scales = UI_SIZE_NAMES.map((size) =>
      Number(token(phone, rule(size), "--chrome-scale")),
    );
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(new Set(scales).size).toBe(scales.length);
  });
});

describe("a tablet's two larger steps", () => {
  it("keeps the bar at Large's row", () => {
    const css = sheet("ui-sizes.css");
    for (const size of ["xlarge", "xxlarge"])
      expect(
        token(
          css,
          `:root[data-ui-size="${size}"]:not([data-window-chrome="mobile"])`,
          "--window-bar-row",
        ),
      ).toBe("48px");
  });
});

describe("the smallest step on a touch screen", () => {
  // 11pt is the least iOS draws text at; measured in the running app, the
  // smallest interface text on a phone is 13px and on an iPad 12px.
  it("keeps every text role at 11px or more", () => {
    const phone = sheet("ui-sizes-phone.css");
    const small = `:root[data-window-chrome="mobile"][data-ui-size="small"]`;
    for (const role of ["caption", "footnote", "secondary", "body"])
      expect(
        Number.parseFloat(token(phone, small, `--text-${role}`) ?? "0"),
      ).toBeGreaterThanOrEqual(11);
    const css = sheet("ui-sizes.css");
    const tablet = `:root[data-ui-size="small"]:not([data-window-chrome="mobile"])`;
    for (const role of ["caption", "list", "body"])
      expect(
        Number.parseFloat(token(css, tablet, `--text-${role}`) ?? "0"),
      ).toBeGreaterThanOrEqual(11);
  });
});
