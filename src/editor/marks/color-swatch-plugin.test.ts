import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import { colorSwatchPlugin } from "./color-swatch-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    md_code_span: { content: "text*", group: "inline", inline: true },
    md_span: { content: "inline*", group: "inline", inline: true },
    wikilink: { content: "text*", group: "inline", inline: true, code: true },
    hardbreak: { group: "inline", inline: true },
    text: { group: "inline" },
  },
  marks: { link: { attrs: { href: {} } } },
});

const text = (value: string) => schema.text(value);

function stateOf(blocks: ProseNode[], enabled: { on: boolean }) {
  return EditorState.create({
    doc: schema.node("doc", null, blocks),
    plugins: [colorSwatchPlugin(() => enabled.on)],
  });
}

const para = (...content: ProseNode[]) =>
  schema.node("paragraph", null, content);
const code = (value: string) =>
  schema.node("md_code_span", null, value ? [text(value)] : []);

function stateWith(codes: string[], enabled: { on: boolean }) {
  return stateOf(
    [para(...codes.flatMap((value) => [text("x "), code(value)]))],
    enabled,
  );
}

const decorations = (state: EditorState) =>
  (state.plugins[0].getState(state) as { set: DecorationSet }).set.find();

const swatches = (state: EditorState) => decorations(state).map((d) => d.from);

/** The colours of the swatches drawn in plain text. */
const plainSwatches = (state: EditorState) =>
  decorations(state)
    .filter((d) => d.to > d.from)
    .map((d) => (d.spec as { color: string }).color);

describe("colorSwatchPlugin", () => {
  it("draws nothing while off, the default", () => {
    expect(swatches(stateWith(["#fff"], { on: false }))).toEqual([]);
    expect(swatches(stateOf([para(text("a #ff8800"))], { on: false }))).toEqual(
      [],
    );
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

  it("draws a swatch before a colour code in a paragraph or heading, on its first character", () => {
    const state = stateOf(
      [
        para(text("Orange #ff8800 and rgb(0 128 255).")),
        schema.node("heading", null, [text("Brand #1e90ff")]),
      ],
      { on: true },
    );
    expect(plainSwatches(state)).toEqual([
      "#ff8800",
      "rgb(0 128 255)",
      "#1e90ff",
    ]);
    // "Orange " is 1-8: the swatch covers the "#" at 8.
    const [first] = decorations(state);
    expect([first.from, first.to]).toEqual([8, 9]);
  });

  it("reads a code inside bold, and judges its neighbours across it", () => {
    const bold = (value: string) => schema.node("md_span", null, [text(value)]);
    const state = stateOf(
      [para(text("a "), bold("#ff8800")), para(text("x"), bold("#00ff00"))],
      { on: true },
    );
    expect(plainSwatches(state)).toEqual(["#ff8800"]);
  });

  it("leaves link text, wikilinks, fenced code and hashtags alone", () => {
    const state = stateOf(
      [
        para(
          schema.text("#ff8800", [schema.mark("link", { href: "x" })]),
          text(" "),
          schema.node("wikilink", null, [text("[[#ff8800]]")]),
        ),
        schema.node("code_block", null, [text("color: #ff8800;")]),
        para(text("#add #cafe #234 https://x.com/#ff8800")),
      ],
      { on: true },
    );
    expect(swatches(state)).toEqual([]);
  });

  it("takes a hard break as a line's end", () => {
    const state = stateOf(
      [para(text("#ff8800"), schema.node("hardbreak"), text("#00ff00"))],
      { on: true },
    );
    expect(plainSwatches(state)).toEqual(["#ff8800", "#00ff00"]);
  });

  it("redraws a plain-text code as it is typed, and holds still while an IME composes", () => {
    let state = stateOf([para(text("a #ff880 b"))], { on: true });
    expect(plainSwatches(state)).toEqual([]);
    // "#ff880" -> "#ff8800", mid-composition: drawn only once it ends.
    state = state.apply(state.tr.insertText("0", 9).setMeta("composition", 1));
    expect(plainSwatches(state)).toEqual([]);
    state = state.apply(state.tr.setMeta(state.plugins[0], "flush"));
    expect(plainSwatches(state)).toEqual(["#ff8800"]);
    // Typing a letter right after it makes it part of a word.
    state = state.apply(state.tr.insertText("x", 10));
    expect(plainSwatches(state)).toEqual([]);
  });
});
