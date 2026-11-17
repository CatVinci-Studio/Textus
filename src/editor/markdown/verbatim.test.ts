// @vitest-environment jsdom
// A plugin's document types reach the editor as the plugin system loads.
import "../../plugins/contributions/editor-extensions";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../editor-test-kit";
import { readSourceBlocks, writePreservingSource } from "./source-preserving";
import { documentTypeOf } from "../../files/document-name";
import {
  publish,
  type PluginsSnapshot,
} from "../../plugins/store/plugin-records";
import { scanSource } from "./verbatim-scan";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

// Shaped after Docusaurus's and Nextra's own docs.
const MDX = `---
title: Install
---

import Tabs from '@theme/Tabs';
export const Highlight = ({children, color}) => (
  <span style={{backgroundColor: color}}>{children}</span>
);

## Install {#setup}

Text with <Highlight color="#25c2a0">inline JSX</Highlight> and {props.version} here.

<Tabs groupId="os">
  <TabItem value="mac" label="macOS" default>

Run the *installer*.

  </TabItem>
</Tabs>

<Image alt="A" width={400} height={300} />

{/* a comment */}

Last paragraph.
`;

async function open(markdown: string, path: string) {
  const editor = await createTestEditor(markdown, {}, path);
  editors.push(editor);
  return editor;
}

/** The whole document serialized, every block as if edited. */
const serialized = (editor: Editor) =>
  editor.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );

const verbatimTexts = (doc: ProseNode) => {
  const texts: string[] = [];
  doc.descendants((node) => {
    if (node.attrs.verbatim) texts.push(node.textContent);
  });
  return texts;
};

describe("MDX kept as written", () => {
  it("writes every block back as read, even edited ones", async () => {
    expect(await serialized(await open(MDX, "/docs/a.mdx"))).toBe(MDX);
  });

  it.each([
    [
      "attributes HTML can't read",
      "<Tabs items={['pnpm', 'npm']}>\n  <Tabs.Tab>pnpm i</Tabs.Tab>\n</Tabs>\n",
    ],
    [
      "JSX in an attribute",
      "Click <Foo render={() => <b />}>here</Foo> now.\n",
    ],
    [
      "a handler in a line",
      "Use <Button onClick={() => alert('hi')}>Go</Button> now.\n",
    ],
    ["an image component", '<Image src="/a.png" alt="A" width={400} />\n'],
    [
      "an export over a blank line",
      "export const x = {\n  a: 1,\n\n    b: 2,\n};\n\nText.\n",
    ],
    ["a fragment", "<>\n  <A />\n</>\n"],
    ["an admonition", ":::note[Title with *md*]\n\nSome {content}.\n\n:::\n"],
    ["math braces", "Inline $\\frac{a}{b}$ math.\n\n$$\n\\frac{1}{2}\n$$\n"],
  ])("writes %s back as read", async (_name, mdx) => {
    expect(await serialized(await open(mdx, "/docs/a.mdx"))).toBe(mdx);
  });

  it("keeps imports, expressions and components as source", async () => {
    const editor = await open(MDX, "/docs/a.mdx");
    const texts = await editor.action((ctx) =>
      verbatimTexts(ctx.get(editorViewCtx).state.doc),
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^import Tabs[\s\S]*\);$/),
        "{#setup}",
        "{props.version}",
        '<Highlight color="#25c2a0">',
        '<Image alt="A" width={400} height={300} />',
        "{/* a comment */}",
      ]),
    );
  });

  it("saves an edit next to an expression with the expression untouched", async () => {
    const editor = await open(MDX, "/docs/a.mdx");
    const saved = await editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const source = readSourceBlocks(ctx, MDX, view.state.doc)!;
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text!.startsWith("Text with"))
          at = pos + "Text".length;
      });
      view.dispatch(view.state.tr.insertText(" *starred*", at));
      return writePreservingSource(ctx, source, view.state.doc);
    });
    expect(saved).toBe(MDX.replace("Text with", "Text \\*starred\\* with"));
  });

  it("leaves a .md file's braces and imports to Markdown", async () => {
    const editor = await open("import x\n\nSome {braces} here\n", "/docs/a.md");
    const texts = await editor.action((ctx) =>
      verbatimTexts(ctx.get(editorViewCtx).state.doc),
    );
    expect(texts).toEqual([]);
  });
});

describe("a plugin's document type", () => {
  it("keeps what its manifest names", async () => {
    publish({
      allOn: true,
      records: [
        {
          id: "a.quarto",
          status: "on",
          manifest: {
            contributes: {
              documentTypes: [
                {
                  extensions: ["qmd"],
                  keep: { blockStarts: [":::"], braces: true, jsx: false },
                },
              ],
            },
          },
        },
      ] as unknown as PluginsSnapshot["records"],
    });
    const qmd =
      "::: {.callout-note}\nA *note* [here]\n:::\n\nSee {{< var v >}} and @fig-a.\n";
    try {
      expect(await serialized(await open(qmd, "/r/a.qmd"))).toBe(qmd);
    } finally {
      publish({ records: [] });
    }
  });
});

describe("rules", () => {
  it("are MDX's for .mdx only", () => {
    expect(documentTypeOf("/a/b.MDX")?.keep).toBeTruthy();
    expect(documentTypeOf("/a/b.md")?.keep).toBeNull();
    expect(documentTypeOf("/a/b.pdf")).toBeNull();
  });

  it("find balanced braces, past escapes and skipped code", () => {
    const text = "a {b {c}} \\{d} `{e}` {f";
    const code = text.indexOf("`");
    const scan = scanSource(text, 0, [[code, code + 5]], {
      braces: true,
      jsx: false,
    });
    expect(scan).toEqual({ ranges: [[2, 9]], open: true });
  });

  it("read a comment in an expression past its apostrophe and brace", () => {
    const rules = { braces: true, jsx: false };
    const block = "{/* don't ship } yet */} after {x}";
    expect(scanSource(block, 0, [], rules)).toEqual({
      ranges: [
        [0, 24],
        [31, 34],
      ],
      open: false,
    });
    const line = "{value // it's here }\n} after";
    expect(scanSource(line, 0, [], rules)).toEqual({
      ranges: [[0, 23]],
      open: false,
    });
    // Never closed: still open at the end.
    expect(scanSource("{/* don't", 0, [], rules).open).toBe(true);
  });
});
