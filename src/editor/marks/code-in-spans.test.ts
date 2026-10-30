// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// Inline code inside bold, italic and strikethrough: typed, made with
// Mod+B, pasted, and saved as written.

afterEach(closeViews);

const open = (markdown = "") => openView(markdown, { enableCompletion: false });

const textOf = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll(selector)].map((e) => e.textContent);

it("code typed inside bold, italic and strikethrough is code", async () => {
  const t = await open();
  t.type("**bold `code` bold** *it `c`* ~~gone `x`~~ end");
  expect(textOf(t.view.dom, "strong code")).toEqual(["code"]);
  expect(textOf(t.view.dom, "em code")).toEqual(["c"]);
  expect(textOf(t.view.dom, "del code")).toEqual(["x"]);
  expect(t.markdown()).toBe("**bold `code` bold** *it `c`* ~~gone `x`~~ end");
  // Read back from what was saved, it is the same.
  const again = await open(t.markdown());
  expect(textOf(again.view.dom, "strong code")).toEqual(["code"]);
});

it("Mod+B makes a selection with code in it bold", async () => {
  const t = await open();
  t.paste("Run `npm test` first.");
  // From after "Run " to before "." - across the code.
  t.select(5, 21);
  t.press("Mod+b");
  expect(textOf(t.view.dom, "strong code")).toEqual(["npm test"]);
  expect(t.markdown()).toBe("Run **`npm test` first**.");
});

it("pasted bold around code stays bold around code", async () => {
  const t = await open();
  t.paste("粗体 **加粗 `代码` 加粗** 完");
  expect(textOf(t.view.dom, "strong code")).toEqual(["代码"]);
  expect(t.markdown()).toBe("粗体 **加粗 `代码` 加粗** 完");
});

it("a paste that starts with bold keeps it", async () => {
  const t = await open();
  t.paste("**bold `code` bold** after");
  expect(textOf(t.view.dom, "strong code")).toEqual(["code"]);
  t.press("Enter");
  t.paste("`code` and $x$");
  expect(textOf(t.view.dom, "p:nth-of-type(2) code")).toEqual(["code"]);
  expect(t.markdown()).toBe("**bold `code` bold** after\n\n`code` and $x$");
});
