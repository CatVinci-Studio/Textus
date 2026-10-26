// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDoc: {
    exportSaveDialog: vi.fn(),
    exportPdfNative: vi.fn(),
    revealInDir: vi.fn(),
  },
  showMessage: vi.fn(),
  fs: { readBinaryFileBase64: vi.fn(), writeTextFile: vi.fn() },
}));

vi.mock("../platform/ipc", () => ({
  exportDoc: mocks.exportDoc,
  fs: mocks.fs,
}));

vi.mock("../platform/capabilities", () => ({
  canExportPdf: true,
  canExportWithPandoc: true,
}));
vi.mock("../ui/app-dialog", () => ({
  showMessage: mocks.showMessage,
  showConfirm: vi.fn(),
}));

import type { Strings } from "../i18n/strings";
import type { DocTab } from "../document/doc-tabs";
import {
  buildStandaloneHtml,
  cloneEditorContent,
  exportHtml,
  exportPdf,
  pdfLayoutCss,
} from "./exporters";
import { MAC_PAGE, WINDOWS_PAGE } from "./paginate";

function editor(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "milkdown";
  root.innerHTML = html;
  return root;
}

describe("cloneEditorContent", () => {
  it("drops editing affordances that are not document content", () => {
    const html = cloneEditorContent(
      editor(
        '<h1><span class="heading-marker"># </span>Title</h1>' +
          '<div class="code-block-wrapper"><div class="code-block-header">js</div><pre>x</pre></div>',
      ),
    );
    expect(html).not.toContain("heading-marker");
    expect(html).not.toContain("code-block-header");
    expect(html).toContain("Title");
    expect(html).toContain("<pre>x</pre>");
  });

  it("drops a code block's copy button and line numbers, and lets its lines wrap again", () => {
    const html = cloneEditorContent(
      editor(
        '<div class="code-block-wrapper md-fences code-block-numbered">' +
          '<div class="code-block-header"><button class="code-block-copy">Copy</button></div>' +
          '<pre><span class="code-line-gutter"><span>1</span></span><code>x</code></pre></div>',
      ),
    );
    expect(html).not.toContain("Copy");
    expect(html).not.toContain("code-line-gutter");
    expect(html).not.toContain("code-block-numbered");
    expect(html).toContain("<pre><code>x</code></pre>");
  });

  it("writes the link the caret shows as its Markdown as the link", async () => {
    const { renderMarkdownInlineHtml } =
      await import("../editor/markdown/render-html");
    const html = cloneEditorContent(
      editor(
        '<p>see <span data-type="link_source" class="link-source">' +
          '<span class="link-source-syntax">[</span>a<span class="link-source-syntax">](https://x.org)</span>' +
          "</span> end</p>",
      ),
      "document",
      renderMarkdownInlineHtml,
    );
    expect(html).toContain('<p>see <a href="https://x.org">a</a> end</p>');
  });

  it("drops a colour code's swatch, keeping the code", () => {
    const html = cloneEditorContent(
      editor(
        '<p>White <code class="md-code-span"><span class="color-swatch" style="--color-swatch: #fff"></span>#fff</code></p>',
      ),
    );
    expect(html).not.toContain("color-swatch");
    expect(html).toContain('<code class="md-code-span">#fff</code>');
  });

  it("drops a plain-text colour code's swatch, keeping its text", () => {
    const html = cloneEditorContent(
      editor(
        '<p>Orange <span class="color-swatch-text" style="--color-swatch: #ff8800">#</span>ff8800.</p>',
      ),
    );
    expect(html).not.toContain("color-swatch");
    expect(html).toContain("<p>Orange #ff8800.</p>");
  });

  it("exports a missing image as the image it was written as, without its card", () => {
    const html = cloneEditorContent(
      editor(
        '<p><span class="image-view image-missing">' +
          '<img src="http://asset.localhost/x" data-doc-src="assets/cat.png">' +
          '<span class="missing-image-card">Image not found: cat.png' +
          '<span class="missing-image-actions"><button>Choose image…</button></span>' +
          "</span></span></p>",
      ),
    );
    expect(html).toContain('<img src="assets/cat.png">');
    expect(html).not.toContain("missing-image");
    expect(html).not.toContain("image-missing");
    expect(html).not.toContain("<button");
  });

  it("puts the markdown folded under a <details> back inside it", () => {
    // What details-fold.ts draws for "<details><summary>…" +
    // markdown + "</details>", nested once, the inner one folded.
    const root0 = editor(
      '<div class="ProseMirror">' +
        '<p data-head="0"><span class="raw-html-source raw-html-source-hidden">&lt;details&gt;</span></p>' +
        '<p class="raw-html-details-in-0">One</p>' +
        '<p class="raw-html-details-in-0" data-head="9"></p>' +
        '<p class="raw-html-details-in-0 raw-html-details-in-9 raw-html-details-folded">Two</p>' +
        '<p class="raw-html-details-in-0 raw-html-details-end">&lt;/details&gt;</p>' +
        '<p class="raw-html-details-end">&lt;/details&gt;</p>' +
        "<p>After</p></div>",
    );
    // The widget is a <div> inside the head's <p>, which only DOM calls
    // (as ProseMirror makes) can build.
    for (const [id, summary, open] of [
      ["0", "Outer", true],
      ["9", "Inner", false],
    ] as const) {
      const widget = document.createElement("div");
      widget.className = "raw-html-rendered raw-html-details-head";
      widget.innerHTML = `<details data-details-head="${id}"><summary>${summary}</summary></details>`;
      widget.querySelector("details")!.open = open;
      root0.querySelector(`[data-head="${id}"]`)!.appendChild(widget);
    }
    const html = cloneEditorContent(root0);
    const root = new DOMParser().parseFromString(html, "text/html");
    const outer = root.querySelector(".ProseMirror > details")!;
    expect(outer.hasAttribute("open")).toBe(true);
    expect(outer.querySelector(":scope > summary")?.textContent).toBe("Outer");
    expect(outer.querySelector(":scope > p")?.textContent).toBe("One");
    const inner = outer.querySelector(":scope > details")!;
    expect(inner.hasAttribute("open")).toBe(false);
    expect(inner.querySelector(":scope > p")?.textContent).toBe("Two");
    expect(html).not.toContain("raw-html-details-folded");
    expect(html).not.toContain("&lt;/details&gt;");
    expect(html).not.toContain("data-details-head");
    expect(root.querySelector(".ProseMirror > p:last-child")?.textContent).toBe(
      "After",
    );
  });

  it("turns a resized table's pixel columns into shares of the page width", () => {
    const html = cloneEditorContent(
      editor(
        '<table style="width: 1000px"><colgroup><col style="width: 750px"><col style="width: 250px"></colgroup><tbody></tbody></table>',
      ),
    );
    expect(html).not.toContain("1000px");
    expect(html).toContain("width: 75%");
    expect(html).toContain("width: 25%");
  });

  it("leaves partly sized tables to share the width evenly", () => {
    const html = cloneEditorContent(
      editor(
        '<table style="min-width: 50px"><colgroup><col style="width: 300px"><col></colgroup><tbody></tbody></table>',
      ),
    );
    expect(html).not.toContain("px");
  });

  it("gives an exported file the document's own image paths back", () => {
    const html = cloneEditorContent(
      editor(
        '<p><img src="asset://localhost/%2Fdocs%2Fassets%2Fa.png" data-doc-src="assets/a.png"></p>',
      ),
    );
    expect(html).toContain('src="assets/a.png"');
    expect(html).not.toContain("asset://");
    expect(html).not.toContain("data-doc-src");
  });

  it("keeps the rendered image source for a self-contained render", () => {
    const html = cloneEditorContent(
      editor(
        '<p><img src="asset://localhost/a.png" data-doc-src="assets/a.png"></p>',
      ),
      "inline",
    );
    expect(html).toContain('src="asset://localhost/a.png"');
  });
});

describe("pdfLayoutCss", () => {
  it("leaves Linux's sheet margins to the GTK page setup", () => {
    // Any other @page margin made WebKitGTK cut taller pages that still
    // started below the setup's top margin, so their last lines ran off the
    // sheet (#68).
    const css = pdfLayoutCss(null, true);
    expect(css).toContain("@page { margin: auto; }");
    expect(css).not.toContain("@page { margin: 0");
  });

  it("keeps a zero sheet margin where the margins are laid out", () => {
    expect(pdfLayoutCss(MAC_PAGE)).toContain("@page { margin: 0; }");
    expect(pdfLayoutCss(WINDOWS_PAGE, true)).toContain("@page { margin: 0; }");
  });

  it("prints a white page instead of the theme's page colour", () => {
    const css = pdfLayoutCss(WINDOWS_PAGE, true);
    expect(css).toContain("html, body { margin: 0; background: #fff; }");
    expect(css).toContain("--editor-bg: #fff !important");
  });

  it("keeps the theme's page colour on macOS", () => {
    const css = pdfLayoutCss(MAC_PAGE);
    expect(css).toContain("background: var(--editor-bg, var(--bg));");
    expect(css).not.toContain("#fff");
  });
});

describe("buildStandaloneHtml", () => {
  it("renders a white page in the theme's light form", () => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "dark");
    root.setAttribute("data-content-theme", "paper");
    try {
      expect(buildStandaloneHtml("a", "<p>x</p>", "", true)).toContain(
        '<html data-theme="light" data-content-theme="paper">',
      );
      expect(buildStandaloneHtml("a", "<p>x</p>", "")).toContain(
        '<html data-theme="dark" data-content-theme="paper">',
      );
    } finally {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-content-theme");
    }
  });
});

describe("buildStandaloneHtml image alignment", () => {
  it("keeps the image alignment the document is shown with", () => {
    const root = document.documentElement;
    expect(buildStandaloneHtml("a", "<p>x</p>", "")).not.toContain(
      "data-image-align",
    );
    root.setAttribute("data-image-align", "left");
    try {
      expect(buildStandaloneHtml("a", "<p>x</p>", "")).toContain(
        'data-image-align="left"',
      );
    } finally {
      root.removeAttribute("data-image-align");
    }
  });
});

describe("exportPdf", () => {
  const t = {
    pdfPreparing: "Preparing PDF…",
    pdfFailed: "Couldn't prepare the PDF:",
    exportFailedTitle: "Export failed",
  } as Strings;
  const tab = { id: "1", path: "/docs/a.md" } as DocTab;

  it("takes the progress overlay down before it reports a failure", async () => {
    document.body.innerHTML =
      '<div data-active-tab="true"><div class="milkdown"><p>x</p></div></div>';
    mocks.exportDoc.exportSaveDialog.mockResolvedValue("/tmp/a.pdf");
    mocks.exportDoc.exportPdfNative.mockRejectedValue("Printer not found");
    let overlayUnderMessage: Element | null = null;
    mocks.showMessage.mockImplementation(async () => {
      overlayUnderMessage = document.querySelector(".pdf-export-overlay");
    });

    await exportPdf(tab, t);

    expect(mocks.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("Printer not found"),
      expect.objectContaining({ tone: "error" }),
    );
    // The overlay sits above the app's dialogs: left up, it covered the
    // message and its button, and the spinner never stopped (#62).
    expect(overlayUnderMessage).toBeNull();
    expect(document.querySelector(".pdf-export-overlay")).toBeNull();
  });

  it("asks Rust for page numbers only when the setting is on", async () => {
    document.body.innerHTML =
      '<div data-active-tab="true"><div class="milkdown"><p>x</p></div></div>';
    mocks.exportDoc.exportSaveDialog.mockResolvedValue("/tmp/a.pdf");
    mocks.exportDoc.exportPdfNative.mockReset().mockResolvedValue(undefined);
    mocks.exportDoc.revealInDir.mockResolvedValue(undefined);

    await exportPdf(tab, t);
    await exportPdf(tab, t, true);

    const calls = mocks.exportDoc.exportPdfNative.mock.calls;
    expect(calls.map(([args]) => args.pageNumbers)).toEqual([false, true]);
    // The page itself is rendered the same either way.
    expect(calls[0][0].html).toBe(calls[1][0].html);
  });

  it("embeds a local image read from the document's folder", async () => {
    document.body.innerHTML = activeEditorWithImage;
    mocks.exportDoc.exportSaveDialog.mockResolvedValue("/tmp/a.pdf");
    mocks.exportDoc.exportPdfNative.mockReset().mockResolvedValue(undefined);
    mocks.fs.readBinaryFileBase64.mockReset().mockResolvedValue("QUJD");
    // Loaded, as far as settleRender asks (jsdom loads no images).
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 10 });

    await exportPdf(tab, t);

    expect(mocks.fs.readBinaryFileBase64).toHaveBeenCalledWith(
      "/docs/assets/my pic.png",
    );
    const { html } = mocks.exportDoc.exportPdfNative.mock.calls[0][0];
    expect(html).toContain('src="data:image/png;base64,QUJD"');
    expect(html).not.toContain("asset://");
    expect(html).not.toContain("data-doc-src");
  });
});

// The editor's image as image-plugin.ts shows it: an asset: URL, with the
// src the markdown has kept beside it.
const activeEditorWithImage =
  '<div data-active-tab="true"><div class="milkdown"><p>' +
  '<img src="asset://localhost/%2Fdocs%2Fassets%2Fmy%20pic.png" data-doc-src="assets/my%20pic.png">' +
  "</p></div></div>";

describe("exportHtml", () => {
  const t = { exportFailedTitle: "Export failed" } as Strings;
  const tab = { id: "1", path: "/docs/a.md" } as DocTab;

  async function exported(picked: string): Promise<string> {
    document.body.innerHTML = activeEditorWithImage;
    mocks.exportDoc.exportSaveDialog.mockResolvedValue(picked);
    mocks.fs.writeTextFile.mockReset().mockResolvedValue(undefined);
    mocks.fs.readBinaryFileBase64.mockReset().mockResolvedValue("QUJD");
    await exportHtml(tab, t);
    return mocks.fs.writeTextFile.mock.calls[0][1] as string;
  }

  it("keeps the document's image paths in a page saved beside it", async () => {
    const html = await exported("/docs/a.html");
    expect(html).toContain('src="assets/my%20pic.png"');
    expect(mocks.fs.readBinaryFileBase64).not.toHaveBeenCalled();
  });

  it("embeds the images of a page saved in another folder", async () => {
    // Its relative paths would point at nothing there.
    const html = await exported("/elsewhere/a.html");
    expect(html).toContain('src="data:image/png;base64,QUJD"');
    expect(html).not.toContain("assets/my");
  });
});
