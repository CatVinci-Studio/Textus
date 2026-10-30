// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import type { Settings } from "../../prefs/SettingsContext";

// A colour code gets a swatch before it, per Settings: off (the default),
// in code only, or everywhere - in the whole editor, every kind of block.

afterEach(closeViews);

type Mode = Settings["colorSwatches"];
const DOC = "White `#fff`, blue `rgb(0 128 255)` and plain `red`.";
const RICH = [
  "# Brand #1e90ff",
  "",
  "Orange #ff8800 and rgb(0 128 255), tagged #add #cafe, issue #234, [#00ff00](https://x.org) and https://x.org/#a1b2c3.",
  "",
  "- A list item #ff0000, but not the short #f00",
  "",
  "> A quote hsl(120 50% 50%)",
  "",
  "| Name | Code |",
  "| --- | --- |",
  "| Teal | #008080 |",
  "",
  "Inline `#ff00ff`, short `#f0f` and `red`.",
  "",
  "```css",
  "a { color: #ff8800; border-color: #fff; } /* see #234 */",
  "#fed { }",
  "```",
  "",
].join("\n");

const open = (markdown: string, mode?: Mode) =>
  openView(markdown, mode ? { colorSwatches: mode } : {});

const swatches = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".color-swatch")].map((el) => [
    el.closest("code")?.textContent,
    el.style.getPropertyValue("--color-swatch"),
  ]);

/** Each plain-text swatch: its block, its colour, and the character it is
 *  drawn before. */
const textSwatches = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".color-swatch-text")].map((el) => [
    (el.closest("h1, li, blockquote, td, pre") ?? el.closest("p"))?.tagName,
    el.style.getPropertyValue("--color-swatch"),
    el.textContent,
  ]);

it("there are no swatches by default", async () => {
  const t = await open(DOC);
  expect(swatches(t.view.dom)).toEqual([]);
});

it("a hex or rgb() code gets a swatch of its colour, a colour name doesn't", async () => {
  const t = await open(DOC, "everywhere");
  expect(swatches(t.view.dom)).toEqual([
    ["#fff", "#fff"],
    ["rgb(0 128 255)", "rgb(0 128 255)"],
  ]);
});

it("everywhere: a colour code in a heading, paragraph, list, quote, table or code block gets a swatch; tags, issues and links don't", async () => {
  const t = await open(RICH, "everywhere");
  expect(textSwatches(t.view.dom)).toEqual([
    ["H1", "#1e90ff", "#"],
    ["P", "#ff8800", "#"],
    ["P", "rgb(0 128 255)", "r"],
    ["LI", "#ff0000", "#"],
    ["BLOCKQUOTE", "hsl(120 50% 50%)", "h"],
    ["TD", "#008080", "#"],
    // Short hex counts in code, an id selector doesn't.
    ["PRE", "#ff8800", "#"],
    ["PRE", "#fff", "#"],
  ]);
  // Inline code keeps its own swatch, short hex too.
  expect(swatches(t.view.dom)).toHaveLength(2);
  // The swatch adds no text.
  expect(t.view.dom.querySelector("h1")?.textContent).toMatch(
    /^(# )?Brand #1e90ff$/,
  );
});

it("in code only: inline code and code blocks get swatches, the text doesn't", async () => {
  const t = await open(RICH, "code");
  expect(textSwatches(t.view.dom)).toEqual([
    ["PRE", "#ff8800", "#"],
    ["PRE", "#fff", "#"],
  ]);
  expect(swatches(t.view.dom)).toHaveLength(2);
  // The code block keeps its text and its highlighting.
  expect(t.view.dom.querySelector("pre")?.textContent).toContain(
    "a { color: #ff8800; border-color: #fff; }",
  );
  expect(t.view.dom.querySelector("pre .token")).not.toBeNull();
});

it("there are no swatches with the setting off", async () => {
  const t = await open(RICH, "off");
  expect(textSwatches(t.view.dom)).toEqual([]);
  expect(swatches(t.view.dom)).toEqual([]);
});

it("a swatch follows a colour code as it is typed and unmade", async () => {
  const t = await open("Accent here.", "everywhere");
  t.type(" #ff880");
  expect(textSwatches(t.view.dom)).toHaveLength(0);
  t.type("0");
  expect(textSwatches(t.view.dom)).toHaveLength(1);
  t.type("x");
  expect(textSwatches(t.view.dom)).toHaveLength(0);
  t.press("Backspace");
  expect(textSwatches(t.view.dom)).toHaveLength(1);
  expect(t.markdown()).toBe("Accent here. #ff8800");
});
