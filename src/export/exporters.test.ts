// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDoc: {
    exportSaveDialog: vi.fn(),
    exportPdfNative: vi.fn(),
    revealInDir: vi.fn(),
  },
  showMessage: vi.fn(),
}));

vi.mock("../platform/ipc", () => ({ exportDoc: mocks.exportDoc, fs: {} }));
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

  it("puts the markdown folded under a <details> back inside it", () => {
    // What raw-html-preview-plugin.ts draws for "<details><summary>…" +
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

  it("keeps the heading marks off when they are off on screen (#136)", () => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "light");
    expect(buildStandaloneHtml("a", "<p>x</p>", "")).not.toContain(
      "data-no-heading-marks",
    );
    root.setAttribute("data-no-heading-marks", "");
    try {
      expect(buildStandaloneHtml("a", "<p>x</p>", "")).toContain(
        '<html data-theme="light" data-no-heading-marks>',
      );
    } finally {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-no-heading-marks");
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
});
