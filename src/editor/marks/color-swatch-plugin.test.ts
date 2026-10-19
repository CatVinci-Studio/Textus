import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import { colorOfCode, colorSwatchPlugin } from "./color-swatch-plugin";

describe("colorOfCode", () => {
  it("takes hex, rgb() and hsl() colours", () => {
    for (const code of [
      "#fff",
      "#FFFA",
      "#ff8800",
      "#ff880080",
      "rgb(0, 128, 255)",
      "rgba(0,128,255,.5)",
      "rgb(0 128 255)",
      "rgb(0 128 255 / 50%)",
      "rgb(10%, 20%, 30%)",
      "hsl(120, 50%, 50%)",
      "hsla(120deg, 50%, 50%, 0.3)",
      "hsl(0.5turn 50% 50% / .5)",
      " #fff ",
    ])
      expect(colorOfCode(code), code).toBe(code.trim());
  });

  it("leaves colour names, broken codes and other text alone", () => {
    for (const code of [
      "red",
      "currentColor",
      "transparent",
      "#ff",
      "#fffff",
      "#ggg",
      "rgb(0, 128)",
      "rgb(0, 128, 255",
      "rgb(a, b, c)",
      "hsl(120, 50, 50)",
      "rgb(0 128 255); background: red",
      "url(x)",
      "color: #fff",
      "#fff #000",
      "",
    ])
      expect(colorOfCode(code), code).toBeNull();
  });
});

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    md_code_span: { content: "text*", group: "inline", inline: true },
    text: { group: "inline" },
  },
});

function stateWith(codes: string[], enabled: { on: boolean }) {
  const doc = schema.node("doc", null, [
    schema.node(
      "paragraph",
      null,
      codes.flatMap((code) => [
        schema.text("x "),
        schema.node("md_code_span", null, code ? [schema.text(code)] : []),
      ]),
    ),
  ]);
  return EditorState.create({
    doc,
    plugins: [colorSwatchPlugin(() => enabled.on)],
  });
}

const swatches = (state: EditorState) =>
  (state.plugins[0].getState(state) as { set: DecorationSet }).set
    .find()
    .map((d) => d.from);

describe("colorSwatchPlugin", () => {
  it("draws nothing while off, the default", () => {
    expect(swatches(stateWith(["#fff"], { on: false }))).toEqual([]);
  });

  it("puts a swatch at the start of each colour code's text", () => {
    // "x " 1-3, the first span 3-9 ("#fff" at 4), "x " 9-11, "red" 11-16,
    // "x " 16-18, the last span from 18 (text at 19).
    const state = stateWith(["#fff", "red", "rgb(1 2 3)"], { on: true });
    expect(swatches(state)).toEqual([4, 19]);
  });

  it("follows the setting and the code as it is typed", () => {
    const enabled = { on: false };
    let state = stateWith(["#ff"], enabled);
    enabled.on = true;
    state = state.apply(state.tr);
    expect(swatches(state)).toEqual([]);
    // "#ff" -> "#fff"
    state = state.apply(state.tr.insertText("f", 7));
    expect(swatches(state)).toEqual([4]);
    // Typing before the span moves the swatch with it.
    state = state.apply(state.tr.insertText("yy", 1));
    expect(swatches(state)).toEqual([6]);
    enabled.on = false;
    state = state.apply(state.tr);
    expect(swatches(state)).toEqual([]);
  });
});
