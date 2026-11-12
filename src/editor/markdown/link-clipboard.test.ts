// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeViews, openView } from "../editor-view-kit";

afterEach(closeViews);

const open = (markdown: string) =>
  openView(markdown, { enableCompletion: false });

/** What pasting `html` from another app after "start" saves. */
async function pasted(html: string): Promise<string> {
  const t = await open("start");
  t.caretAtEnd();
  t.paste("plain", html);
  return t.markdown();
}

/** The HTML a copy of the first paragraph puts on the clipboard. */
async function copied(markdown: string): Promise<string> {
  const t = await open(markdown);
  const { doc } = t.view.state;
  t.view.dispatch(
    t.view.state.tr.setSelection(
      TextSelection.create(doc, 1, doc.firstChild!.nodeSize - 1),
    ),
  );
  let html = "";
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, value: string) => {
        if (type === "text/html") html = value;
      },
      clearData() {},
    },
  });
  t.view.dom.dispatchEvent(event);
  return html;
}

describe("a link pasted from a web page", () => {
  it("keeps the picture, formatting and title inside it", async () => {
    expect(
      await pasted(
        '<p>see <a href="https://x.org"><img src="https://x.org/i.png" alt="pic"></a> end</p>',
      ),
    ).toContain("[![pic](https://x.org/i.png)](https://x.org)");
    expect(
      await pasted(
        '<p>see <a href="https://x.org"><strong>bold</strong> text</a> end</p>',
      ),
    ).toContain("[**bold** text](https://x.org)");
    expect(
      await pasted(
        '<p>see <a href="https://x.org"><code>fn()</code></a> end</p>',
      ),
    ).toContain("[`fn()`](https://x.org)");
    expect(
      await pasted(
        '<p>see <a href="https://x.org" title="T">a [b]</a> end</p>',
      ),
    ).toContain('[a \\[b\\]](https://x.org "T")');
  });
});

describe("a link copied to another app", () => {
  it("carries its label as HTML, not Markdown", async () => {
    const html = await copied('See [the **docs**](https://x.org "T") here.');
    expect(html).toContain("the <strong>docs</strong></a>");
    expect(await copied("A [![pic](i.png)](https://x.org) b")).toMatch(
      /<a [^>]*><img src="i.png" alt="pic"><\/a>/,
    );
    expect(await copied("A [`code`](https://x.org) b")).toContain(
      "<code>code</code></a>",
    );
  });
});
