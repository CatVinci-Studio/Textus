// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../editor-test-kit";
import { readSourceBlocks, writePreservingSource } from "./source-preserving";
import { braceRanges, verbatimRulesFor } from "./verbatim";

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

describe("rules", () => {
  it("are MDX's for .mdx only", () => {
    expect(verbatimRulesFor("/a/b.MDX")).not.toBeNull();
    expect(verbatimRulesFor("/a/b.md")).toBeNull();
    expect(verbatimRulesFor(null)).toBeNull();
  });

  it("find balanced braces, past escapes and skipped code", () => {
    const text = "a {b {c}} \\{d} `{e}` {f";
    const code = text.indexOf("`");
    expect(braceRanges(text, 0, [[code, code + 5]])).toEqual([[2, 9]]);
  });
});
