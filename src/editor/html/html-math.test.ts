// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { loadKatex } from "../math/katex-loader";
import { renderWhitelistedHtml } from "./raw-html-sanitize";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

function drawn(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = renderWhitelistedHtml(html)!.html;
  return el;
}

describe("formulas in raw HTML", () => {
  it("draws $…$ and \\(…\\) in a table's cells", async () => {
    await loadKatex();
    const el = drawn(
      "<table><tr><td>$x^2$</td><td>\\(\\alpha\\)</td><td>$$y$$</td></tr></table>",
    );
    expect(el.querySelectorAll("td .katex")).toHaveLength(3);
    expect(el.querySelector("td .katex-display")).not.toBeNull();
  });

  it("leaves code, prices and plain brackets alone", async () => {
    await loadKatex();
    const el = drawn(
      "<div><code>$x$</code> costs $5 and $6, see \\[optional\\]</div>",
    );
    expect(el.querySelector(".katex")).toBeNull();
    expect(el.textContent).toBe("$x$ costs $5 and $6, see \\[optional\\]");
  });

  it("draws a formula in an HTML table in the editor", async () => {
    await loadKatex();
    const editor = await createTestEditor(
      "<table><tr><td>$a+b$</td></tr></table>\n\nend\n",
    );
    editors.push(editor);
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    expect(view.dom.querySelector(".raw-html-rendered td .katex")).not.toBeNull();
  });
});
