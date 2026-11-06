// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { DOMParser } from "@milkdown/kit/prose/model";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { definitionsIn } from "./link-reveal";
import { linkHref } from "./link-syntax";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function open(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor;
}

const save = (editor: Editor) =>
  editor.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );

/** The first link node in the document and where it is. */
function firstLink(editor: Editor): { node: ProseNode; pos: number } {
  return editor.action((ctx) => {
    let found: { node: ProseNode; pos: number } | null = null;
    ctx.get(editorViewCtx).state.doc.descendants((node, pos) => {
      if (node.type.name === "link") found ??= { node, pos };
    });
    return found!;
  });
}

describe("reference links", () => {
  it.each([
    ["a full reference", "A [link][r].\n\n[r]: https://x.org\n"],
    ["a collapsed reference", "A [link][].\n\n[link]: https://x.org\n"],
    ["a shortcut reference", "A [link].\n\n[link]: https://x.org\n"],
    ["a titled definition", 'A [link][r].\n\n[r]: https://x.org "T"\n'],
    ["a label in another case", "A [link][R].\n\n[r]: https://x.org\n"],
    ["a reference image", "An ![image][pic].\n\n[pic]: a.png\n"],
    ["a definition nobody uses", "Text.\n\n[unused]: https://x.org\n"],
    ["a definition in a quote", "> [r]: https://x.org\n\n[a][r]\n"],
  ])("keeps %s", async (_name, markdown) => {
    expect(await save(await open(markdown))).toBe(markdown);
  });

  it("reads a reference as a link to its definition's URL", async () => {
    const editor = await open('A [link][R].\n\n[r]: https://x.org "T"\n');
    const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    expect(
      linkHref(firstLink(editor).node.textContent, () => definitionsIn(doc)),
    ).toBe("https://x.org");
  });

  it("shows a definition as its source", async () => {
    const editor = await open("A [link][r].\n\n[r]:   https://x.org\n");
    const definition = editor.action(
      (ctx) => ctx.get(editorViewCtx).state.doc.child(1).textContent,
    );
    expect(definition).toBe("[r]:   https://x.org");
  });

  it("copies a reference as an ordinary link", async () => {
    // Pasted where its definition isn't, a reference would link nowhere.
    const editor = await open("A [link][r].\n\n[r]: https://x.org\n");
    const pasted = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc, schema } = view.state;
      let slice = doc.slice(0, doc.child(0).nodeSize);
      view.someProp("transformCopied", (f) => {
        slice = f(slice, view);
      });
      const dom = view
        .someProp("clipboardSerializer")!
        .serializeFragment(slice.content);
      return ctx.get(serializerCtx)(DOMParser.fromSchema(schema).parse(dom));
    });
    expect(pasted).toBe("A [link](https://x.org).\n");
  });

  it("writes a reference whose URL was changed as an ordinary link", async () => {
    const editor = await open("A [link][r].\n\n[r]: https://x.org\n");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { node, pos } = firstLink(editor);
      view.dispatch(
        view.state.tr.replaceWith(
          pos + 1,
          pos + node.nodeSize - 1,
          view.state.schema.text("[link](https://y.org)"),
        ),
      );
    });
    expect(await save(editor)).toBe(
      "A [link](https://y.org).\n\n[r]: https://x.org\n",
    );
  });
});
