import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { tableNodes } from "@milkdown/kit/prose/tables";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
  runTableAction,
  selectedImagePos,
  setImageWidth,
  type ContextMenuOptions,
} from "./editor-menu";
import type { EditorRunner } from "./useEditorRunner";
import { resolveStrings } from "../i18n/strings";

// The node names commonmark/gfm register, with just enough spec for the
// table and image commands.
const cells = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {},
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    image: {
      group: "inline",
      inline: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        title: {},
        width: { default: "" },
        html: { default: "" },
      },
    },
    table: { ...cells.table, content: "table_header_row table_row+" },
    table_header_row: { ...cells.table_row, content: "table_header*" },
    table_row: { ...cells.table_row, content: "table_cell*" },
    table_header: cells.table_header,
    table_cell: cells.table_cell,
  },
});
const n = schema.nodes;
const p = (text: string) => n.paragraph.create(null, schema.text(text));
const doc = n.doc.create(null, [
  p("text"),
  n.table.create(null, [
    n.table_header_row.create(null, [n.table_header.create(null, p("A"))]),
    n.table_row.create(null, [n.table_cell.create(null, p("1"))]),
  ]),
  n.paragraph.create(null, n.image.create({ src: "a.png", title: null })),
]);

/** A runner over a bare state, standing in for the editor's: the menu's
 *  commands only reach for the view's state, dispatch and focus. */
function editorAt(position: (state: EditorState) => EditorState) {
  const view = {
    state: position(EditorState.create({ doc })),
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    focus() {},
  };
  const ctx = { get: () => view } as unknown as Ctx;
  const run = (<T>(fn: (ctx: Ctx) => T) => fn(ctx)) as EditorRunner;
  return { view, run };
}
const caretIn = (text: string) => (state: EditorState) => {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos;
  });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, at)),
  );
};
let imagePos = -1;
doc.descendants((node, pos) => {
  if (node.type.name === "image") imagePos = pos;
});
const imageSelected = (state: EditorState) =>
  state.apply(state.tr.setSelection(NodeSelection.create(state.doc, imagePos)));

const t = resolveStrings("en");
const options = (pos: number | null): ContextMenuOptions => ({
  t,
  imagePos: pos,
  aiItems: [],
  copyOrCut: () => {},
  copyAsPlainText: () => {},
  pasteAsPlainText: () => {},
  paste: () => {},
  selectAll: () => {},
  toggleFindReplace: () => {},
  openTableDialog: () => {},
});
const labels = (items: ReturnType<typeof buildContextMenuItems>) =>
  items.map((item) => (item === "separator" ? "-" : item.label));

describe("the editor menu", () => {
  it("keeps the desktop's table menu as it was, with the plain-text copy and paste", () => {
    const { run } = editorAt(caretIn("1"));
    expect(labels(buildContextMenuItems(run, options(null)))).toEqual([
      t.cut,
      t.copy,
      t.copyAsPlainText,
      t.paste,
      t.pasteAsPlainText,
      t.selectAll,
      "-",
      t.findReplace,
      "-",
      t.alignLeft,
      t.alignCenter,
      t.alignRight,
      "-",
      t.selectRow,
      t.selectColumn,
      "-",
      t.insertRowAbove,
      t.insertRowBelow,
      t.insertColumnLeft,
      t.insertColumnRight,
      "-",
      t.deleteRow,
      t.deleteColumn,
      t.deleteTable,
    ]);
  });

  it("offers a picture's file next to its width, as far as it has one", () => {
    const { run } = editorAt(imageSelected);
    const menu = (imageLocation: ContextMenuOptions["imageLocation"]) =>
      labels(
        buildContextMenuItems(run, { ...options(imagePos), imageLocation }),
      ).slice(0, 9);
    const local = menu({ kind: "local", path: "/notes/a.png" });
    expect(local).toEqual([
      `✓ ${t.imageWidthAuto}`,
      t.imageWidth30,
      t.imageWidth50,
      t.imageWidth70,
      t.imageWidth100,
      "-",
      t.imageReveal,
      t.imageCopyPath,
      "-",
    ]);
    // A web image has an address to copy but no folder; a data: URI neither.
    const remote = menu({ kind: "remote", url: "https://x/a.png", host: "x" });
    expect(remote).toContain(t.imageCopyPath);
    expect(remote).not.toContain(t.imageReveal);
    expect(menu({ kind: "other" })).not.toContain(t.imageCopyPath);

    // An Obsidian embed has no width items, only its file.
    expect(
      labels(
        buildContextMenuItems(editorAt(caretIn("text")).run, {
          ...options(null),
          imageLocation: { kind: "local", path: "/vault/cat.png" },
        }),
      ).slice(0, 4),
    ).toEqual([t.imageReveal, t.imageCopyPath, "-", t.cut]);
  });

  it("gives the phone's More only what its toolbar lacks", () => {
    const inTable = labels(
      buildPhoneMoreItems(editorAt(caretIn("1")).run, options(null)),
    );
    expect(inTable).toContain(t.alignCenter);
    expect(inTable).not.toContain(t.insertRowBelow);
    expect(inTable).not.toContain(t.copy);
    // The toolbar copies; only the menu has the plain text.
    expect(inTable).toContain(t.copyAsPlainText);

    const inText = labels(
      buildPhoneMoreItems(editorAt(caretIn("text")).run, options(null)),
    );
    expect(inText).toContain(t.insertTable);
    expect(inText).not.toContain(t.insertBulletList);

    const onImage = labels(
      buildPhoneMoreItems(editorAt(imageSelected).run, options(imagePos)),
    );
    expect(onImage).not.toContain(t.imageWidth50);
  });

  it("runs table actions by name", () => {
    const { view, run } = editorAt(caretIn("1"));
    runTableAction(run, "row-below");
    expect(view.state.doc.child(1).childCount).toBe(3);
    runTableAction(run, "not-an-action");
    expect(view.state.doc.child(1).childCount).toBe(3);
  });

  it("finds the tapped image and can keep it selected through a resize", () => {
    expect(selectedImagePos(editorAt(caretIn("text")).run)).toBeNull();
    const { view, run } = editorAt(imageSelected);
    expect(selectedImagePos(run)).toBe(imagePos);
    setImageWidth(run, imagePos, 50, true);
    expect(view.state.doc.nodeAt(imagePos)?.attrs.width).toBe("50%");
    expect(selectedImagePos(run)).toBe(imagePos);
  });
});
