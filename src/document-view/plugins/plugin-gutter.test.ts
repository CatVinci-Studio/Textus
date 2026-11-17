// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";

const run = vi.fn(async () => null);
vi.mock("../../plugins/manager", () => ({ runPluginCommand: run }));

const { firstLine, gutterMark } = await import("./plugin-gutter");

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*" },
    table: { content: "paragraph+", group: "block", tableRole: "table" },
    rule: { group: "block" },
    text: {},
  },
});
const p = (text: string) => schema.node("paragraph", null, schema.text(text));

describe("a plugin's mark in the margin", () => {
  it("sits in a paragraph's first line, before any other block", () => {
    expect(firstLine(p("one"), 10)).toBe(11);
    const list = schema.node("bullet_list", null, [
      schema.node("list_item", null, [p("a")]),
    ]);
    expect(firstLine(list, 0)).toBe(0);
    // Not in a cell, or after a rule.
    expect(firstLine(schema.node("table", null, [p("cell")]), 7)).toBe(7);
    expect(firstLine(schema.node("rule"), 7)).toBe(7);
  });

  it("is a dot, a character or the plugin's SVG, shown only without a command", () => {
    const dot = gutterMark(
      { block: "b", style: "gutter", plugin: "git" },
      "accent",
    );
    expect(dot.tagName).toBe("SPAN");
    expect(dot.dataset.icon).toBe("dot");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    const char = gutterMark(
      { block: "b", style: "gutter", icon: "M", plugin: "git" },
      "warning",
    );
    expect(char.textContent).toBe("M");
    expect(char.className).toContain("plugin-tone-warning");
    const svg = gutterMark(
      { block: "b", style: "gutter", icon: "<svg></svg>", plugin: "git" },
      "accent",
    );
    expect(svg.dataset.icon).toBe("svg");
  });

  it("with a command, is a named button that runs it", async () => {
    const button = gutterMark(
      {
        block: "b",
        style: "gutter",
        tooltip: "Changed since the last commit",
        command: { id: "git.showDiff", args: ["b"] },
        plugin: "git",
      },
      "accent",
    );
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe(
      "Changed since the last commit",
    );
    button.click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith("git", "git.showDiff", ["b"]),
    );
  });
});
