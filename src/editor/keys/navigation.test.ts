// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Plugin,
} from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { tableNodes } from "@milkdown/kit/prose/tables";
import {
  createMacNavigationPlugin,
  visualLineBoundary,
} from "./mac-navigation-plugin";
import {
  createEscapeTrailingBlockPlugin,
  createTableEdgeArrowPlugin,
} from "../markdown/escape-trailing-block-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    heading: { content: "inline*", group: "block", toDOM: () => ["h1", 0] },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    md_span: {
      content: "inline*",
      group: "inline",
      inline: true,
      toDOM: () => ["strong", 0],
    },
    text: { group: "inline" },
    ...tableNodes({
      tableGroup: "block",
      cellContent: "paragraph+",
      cellAttributes: {},
    }),
  },
});
const block = (type: string, text: string) =>
  schema.node(type, null, text ? schema.text(text) : undefined);

function fixture(
  content = [block("paragraph", "first line"), block("paragraph", "last line")],
  head = 6,
) {
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ doc: schema.node("doc", null, content) }),
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, head)),
  );
  vi.spyOn(view, "coordsAtPos").mockImplementation((pos) => ({
    left: pos * 8,
    right: pos * 8,
    top: 0,
    bottom: 20,
  }));
  const press = (plugin: Plugin, key: string, init: KeyboardEventInit = {}) =>
    plugin.props.handleKeyDown?.call(
      plugin,
      view,
      new KeyboardEvent("keydown", { key, ...init }),
    );
  return { view, press };
}

describe("macOS navigation", () => {
  it.each([
    ["ArrowLeft", 1],
    ["ArrowRight", 11],
    ["ArrowUp", 1],
    ["ArrowDown", 22],
  ] as const)("%s moves without changing content", (key, target) => {
    const { view, press } = fixture();
    const doc = view.state.doc;
    expect(
      press(
        createMacNavigationPlugin(() => true),
        key,
        { metaKey: true },
      ),
    ).toBe(true);
    expect(view.state.selection.head).toBe(target);
    expect(view.state.doc).toBe(doc);
    view.destroy();
  });
  it("preserves the anchor when extending and reversing a selection", () => {
    const { view, press } = fixture();
    const plugin = createMacNavigationPlugin(() => true);
    press(plugin, "ArrowDown", { metaKey: true, shiftKey: true });
    expect(view.state.selection.anchor).toBe(6);
    expect(view.state.selection.head).toBe(22);
    press(plugin, "ArrowUp", { metaKey: true, shiftKey: true });
    expect(view.state.selection.anchor).toBe(6);
    expect(view.state.selection.head).toBe(1);
    view.destroy();
  });
  it("uses visual lines instead of whole paragraphs for wrapped text", () => {
    const { view } = fixture([block("paragraph", "abcdefghijklmnopqrst")], 14);
    vi.mocked(view.coordsAtPos).mockImplementation((pos) => ({
      left: 0,
      right: 0,
      top: pos < 11 ? 0 : 20,
      bottom: pos < 11 ? 20 : 40,
    }));
    expect(visualLineBoundary(view, 14, -1)).toBe(11);
    expect(visualLineBoundary(view, 5, 1)).toBe(10);
    view.destroy();
  });

  it("uses the preceding character at a soft-wrap line end", () => {
    const { view } = fixture([block("paragraph", "abcdefghijklmnopqrst")], 5);
    vi.mocked(view.coordsAtPos).mockImplementation((pos, side = 1) => {
      const firstLine = pos < 11 || (pos === 11 && side < 0);
      return {
        left: 0,
        right: 0,
        top: firstLine ? 0 : 20,
        bottom: firstLine ? 20 : 40,
      };
    });
    expect(visualLineBoundary(view, 5, 1)).toBe(11);
    view.destroy();
  });
  it("navigates out of nested inline formatting to the containing line", () => {
    const paragraph = schema.node("paragraph", null, [
      schema.text("a "),
      schema.node("md_span", null, schema.text("bold")),
      schema.text(" z"),
    ]);
    const { view, press } = fixture([paragraph], 6);
    press(
      createMacNavigationPlugin(() => true),
      "ArrowLeft",
      { metaKey: true },
    );
    expect(view.state.selection.head).toBe(1);
    view.destroy();
  });
  it("leaves Windows, Option combinations and composition alone", () => {
    const { view, press } = fixture();
    expect(
      press(
        createMacNavigationPlugin(() => false),
        "ArrowLeft",
        { metaKey: true },
      ),
    ).toBe(false);
    for (const init of [
      {},
      { metaKey: true, altKey: true },
      { metaKey: true, ctrlKey: true },
      { metaKey: true, isComposing: true },
    ]) {
      expect(
        press(
          createMacNavigationPlugin(() => true),
          "ArrowLeft",
          init,
        ),
      ).toBe(false);
    }
    expect(view.state.selection.head).toBe(6);
    view.destroy();
  });
});

describe("block boundary navigation", () => {
  it.each(["metaKey", "ctrlKey", "altKey", "shiftKey"])(
    "does not insert paragraphs for %s arrows",
    (modifier) => {
      const { view, press } = fixture([block("code_block", "code")], 1);
      const doc = view.state.doc;
      expect(
        press(createEscapeTrailingBlockPlugin(), "ArrowLeft", {
          [modifier]: true,
        }),
      ).toBe(false);
      expect(view.state.doc).toBe(doc);
      view.destroy();
    },
  );
  it("still escapes a leading code block with an ordinary arrow", () => {
    const { view, press } = fixture([block("code_block", "code")], 1);
    expect(press(createEscapeTrailingBlockPlugin(), "ArrowLeft")).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(view.state.doc.childCount).toBe(2);
    view.destroy();
  });
  it.each([
    ["ArrowUp", 2],
    ["ArrowDown", 20],
  ] as const)(
    "%s off a plain first or last line changes nothing (#350)",
    (key, head) => {
      const { view, press } = fixture(undefined, head);
      vi.spyOn(view, "endOfTextblock").mockReturnValue(true);
      const doc = view.state.doc;
      expect(press(createEscapeTrailingBlockPlugin(), key)).toBe(false);
      expect(view.state.doc).toBe(doc);
      view.destroy();
    },
  );
  it("takes an escape line away once the caret leaves it empty, and keeps one typed in", () => {
    const plugin = createEscapeTrailingBlockPlugin();
    const content = [block("code_block", "code"), block("paragraph", "after")];
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        doc: schema.node("doc", null, content),
        plugins: [plugin],
      }),
    });
    const original = view.state.doc;
    const keydown = (key: string) =>
      view.someProp("handleKeyDown", (f) =>
        f(view, new KeyboardEvent("keydown", { key })),
      );
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
    );
    expect(keydown("ArrowLeft")).toBe(true);
    expect(view.state.doc.childCount).toBe(3);
    // Back into the code block, nothing typed: as it was.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    expect(view.state.doc.eq(original)).toBe(true);

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
    );
    keydown("ArrowLeft");
    view.dispatch(view.state.tr.insertText("title", 1));
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 10)),
    );
    expect(view.state.doc.firstChild?.textContent).toBe("title");
    view.destroy();
  });
  it.each([true, false])(
    "table escape respects following content: %s",
    (hasFollowing) => {
      const table = schema.node("table", null, [
        schema.node("table_row", null, [
          schema.node("table_cell", null, [block("paragraph", "cell")]),
        ]),
      ]);
      const { view, press } = fixture(
        hasFollowing ? [table, block("paragraph", "after")] : [table],
        8,
      );
      vi.spyOn(view, "endOfTextblock").mockReturnValue(true);
      const doc = view.state.doc;
      expect(press(createTableEdgeArrowPlugin(), "ArrowDown")).toBe(
        !hasFollowing,
      );
      if (hasFollowing) expect(view.state.doc).toBe(doc);
      else expect(view.state.doc.lastChild?.type.name).toBe("paragraph");
      view.destroy();
    },
  );
  it("leaves a table that starts the document upwards", () => {
    const table = schema.node("table", null, [
      schema.node("table_row", null, [
        schema.node("table_cell", null, [block("paragraph", "cell")]),
      ]),
    ]);
    const { view, press } = fixture([table, block("paragraph", "after")], 8);
    vi.spyOn(view, "endOfTextblock").mockReturnValue(true);
    expect(press(createTableEdgeArrowPlugin(), "ArrowUp")).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(view.state.selection.$from.parent).toBe(view.state.doc.firstChild);
    view.destroy();
  });
});
