// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import {
  DOMParser,
  DOMSerializer,
  Fragment,
  type Mark,
} from "@milkdown/kit/prose/model";
import { createTestEditor } from "../../document-view/editor-test-harness";

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

/** The first link mark in the document. */
function firstLink(editor: Editor): Mark | null {
  return editor.action((ctx) => {
    let found: Mark | null = null;
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      found ??= node.marks.find((mark) => mark.type.name === "link") ?? null;
    });
    return found;
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
    const editor = await open('A [link][r].\n\n[r]: https://x.org "T"\n');
    expect(firstLink(editor)?.attrs).toMatchObject({
      href: "https://x.org",
      title: "T",
    });
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
      const { doc, schema } = ctx.get(editorViewCtx).state;
      const paragraph = doc.child(0).copy(doc.child(0).content);
      const dom = DOMSerializer.fromSchema(schema).serializeFragment(
        Fragment.from(paragraph),
      );
      return ctx.get(serializerCtx)(DOMParser.fromSchema(schema).parse(dom));
    });
    expect(pasted).toBe("A [link](https://x.org).\n");
  });

  it("writes a reference whose URL was changed as an ordinary link", async () => {
    const editor = await open("A [link][r].\n\n[r]: https://x.org\n");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc, schema } = view.state;
      const mark = firstLink(editor)!;
      const from = 3;
      const to = from + "link".length;
      expect(doc.textBetween(from, to)).toBe("link");
      view.dispatch(
        view.state.tr
          .removeMark(from, to, mark)
          .addMark(
            from,
            to,
            schema.marks.link.create({ ...mark.attrs, href: "https://y.org" }),
          ),
      );
    });
    expect(await save(editor)).toBe(
      "A [link](https://y.org).\n\n[r]: https://x.org\n",
    );
  });
});
