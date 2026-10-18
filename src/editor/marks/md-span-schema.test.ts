// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { DOMParser } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** "A ***both*** end" as typing builds it: one rung-3 span (a file's
 *  "***both***" parses as nested bold and italic instead). */
async function openBoldItalic(): Promise<{
  view: EditorView;
  save: (view: EditorView["state"]["doc"]) => string;
}> {
  const editor = await createTestEditor("");
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { schema } = view.state;
    const span = schema.nodes.md_span.create(
      { delim: "*", rung: 3 },
      schema.text("both"),
    );
    view.dispatch(
      view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        schema.nodes.paragraph.create(null, [
          schema.text("A "),
          span,
          schema.text(" end"),
        ]),
      ),
    );
    return { view, save: (doc) => ctx.get(serializerCtx)(doc) };
  });
}

describe("bold+italic spans", () => {
  it("render as one element, so text typed into an empty one lands in it", async () => {
    const { view } = await openBoldItalic();
    const span = view.dom.querySelector('[data-rung="3"]');
    expect(span?.tagName).toBe("STRONG");
    expect(span?.children).toHaveLength(0);
  });

  it("copy as strong>em and paste back as the same span", async () => {
    const { view, save } = await openBoldItalic();
    const { dom } = view.serializeForClipboard(
      view.state.doc.slice(0, view.state.doc.content.size),
    );
    expect(dom.querySelector("strong > em")?.textContent).toBe("both");
    const pasted = DOMParser.fromSchema(view.state.schema).parse(dom);
    expect(pasted.firstChild?.child(1).attrs).toMatchObject({ rung: 3 });
    expect(pasted.firstChild?.child(1).firstChild?.isText).toBe(true);
    expect(save(pasted)).toBe("A ***both*** end\n");
  });
});
