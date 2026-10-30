// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// A link or image typed or pasted becomes a working link or image, and is
// saved without escaping backslashes.

afterEach(closeViews);

const URL = "http://www.baidu.com";
const SRC =
  "https://i.pinimg.com/originals/f8/53/b8/f853b86957f6412dc57eb2949cdfe6ae.jpg";
const LINK = `[百度](${URL})`;
const IMAGE = `![美女](${SRC})`;

const open = (markdown = "") => openView(markdown, { enableCompletion: false });

/** Each link's text and where it points, in order. */
function links(doc: ProseNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    const link = node.marks.find((m) => m.type.name === "link");
    if (link) out.push(`${node.text} -> ${link.attrs.href}`);
  });
  return out;
}

function images(doc: ProseNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "image")
      out.push(`${node.attrs.alt} -> ${node.attrs.src}`);
  });
  return out;
}

type View = Awaited<ReturnType<typeof open>>;
const ways: [string, (t: View, line: string) => void][] = [
  ["typed", (t, line) => t.type(line)],
  [
    "typed with the URL pasted in",
    (t, line) => {
      const at = line.indexOf("](") + 2;
      t.type(line.slice(0, at));
      t.paste(line.slice(at, -1));
      t.type(")");
    },
  ],
  ["pasted", (t, line) => t.paste(line)],
];

for (const [way, write] of ways)
  it(`a link and an image ${way} work and save without backslashes`, async () => {
    const t = await open();
    write(t, LINK);
    t.press("Enter");
    write(t, IMAGE);
    expect(links(t.view.state.doc)).toEqual([`百度 -> ${URL}`]);
    expect(images(t.view.state.doc)).toEqual([`美女 -> ${SRC}`]);
    expect(t.markdown()).toBe(`${LINK}\n\n${IMAGE}`);
  });

it("an image typed mid-sentence goes in where it was typed", async () => {
  const t = await open();
  t.type("See ![](assets/a.png) here");
  expect(images(t.view.state.doc)).toEqual([" -> assets/a.png"]);
  expect(t.markdown()).toBe("See ![](assets/a.png) here");
});

it("words typed after a pasted link are not part of it", async () => {
  const t = await open();
  t.type("See ");
  t.paste("[Textus](https://a.org)");
  t.type(" now");
  expect(links(t.view.state.doc)).toEqual(["Textus -> https://a.org"]);
  t.press("Enter");
  expect(t.markdown()).toBe("See [Textus](https://a.org) now");
});

it("a URL pasted between the parentheses autopair put in makes the link", async () => {
  const t = await open();
  t.type("See [Textus](");
  t.paste("https://a.org");
  // Past the ")" the autopair put in, rather than typing it.
  t.select(t.view.state.selection.from + 1);
  t.type(" now");
  expect(links(t.view.state.doc)).toEqual(["Textus -> https://a.org"]);
  expect(t.markdown()).toBe("See [Textus](https://a.org) now");
});

it("a link written as []() first, then filled in, is one once the caret leaves", async () => {
  const t = await open();
  t.type("See []() now");
  t.caretAt("[]", 1);
  t.type("Textus");
  t.caretAt("](", 2);
  t.paste("https://a.org");
  // Still inside its parentheses: still being written.
  expect(links(t.view.state.doc)).toEqual(["https://a.org -> https://a.org"]);
  const end = t.view.state.doc.firstChild!.nodeSize - 1;
  t.select(end);
  expect(links(t.view.state.doc)).toEqual(["Textus -> https://a.org"]);
  // An undo takes the link back to its text, which then stays text.
  t.press("Mod+z");
  expect(links(t.view.state.doc)).toEqual(["https://a.org -> https://a.org"]);
  t.select(1);
  expect(links(t.view.state.doc)).toEqual(["https://a.org -> https://a.org"]);
  t.press("Mod+Shift+z");
  t.select(t.view.state.doc.firstChild!.nodeSize - 1);
  t.press("Enter");
  expect(t.markdown()).toBe("See [Textus](https://a.org) now");
});

it("escaped brackets read from a file stay text when the paragraph is edited", async () => {
  const t = await open("Write \\[a](b) literally.");
  expect(t.view.state.doc.textContent).toBe("Write [a](b) literally.");
  t.type(" Done");
  t.select(1);
  expect(links(t.view.state.doc)).toEqual([]);
});

it("a URL typed out is a link once a space follows it", async () => {
  const t = await open();
  t.type("See https://a.org");
  // Still being typed: not yet.
  expect(links(t.view.state.doc)).toEqual([]);
  t.type(" now. Or www.b.org.");
  t.press("Enter");
  // The full stop ending the sentence isn't part of it.
  expect(links(t.view.state.doc)).toEqual([
    "https://a.org -> https://a.org",
    "www.b.org -> http://www.b.org",
  ]);
  expect(t.markdown()).toBe("See <https://a.org> now. Or www.b.org.");
});
