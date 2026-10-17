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
});
