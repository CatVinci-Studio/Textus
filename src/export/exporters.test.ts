// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDoc: {
    exportSaveDialog: vi.fn(),
    exportPdfNative: vi.fn(),
    revealInDir: vi.fn(),
  },
  showMessage: vi.fn(),
  fs: { readBinaryFileBase64: vi.fn() },
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
  cloneEditorContent,
  exportPdf,
  localImagePath,
  pdfLayoutCss,
} from "./exporters";
import { MAC_PAGE } from "./paginate";

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
  it("carries the theme background past the content on Linux's last sheet", () => {
    // No pinned page geometry (Linux): nothing fills the last sheet to a
    // page multiple, so the body's shadow has to.
    expect(pdfLayoutCss(null)).toMatch(
      /body \{ box-shadow: 0 0 0 \d+px var\(--editor-bg, var\(--bg\)\); \}/,
    );
  });

  it("leaves paginated renders to their tail spacer", () => {
    expect(pdfLayoutCss(MAC_PAGE)).not.toContain("box-shadow");
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

describe("localImagePath", () => {
  it("names the file a document image src points at", () => {
    expect(localImagePath("assets/a%20b.png", "/docs/x.md")).toBe(
      "/docs/assets/a b.png",
    );
    expect(
      localImagePath("/Users/me/Application%20Support/assets/i.jpg", null),
    ).toBe("/Users/me/Application Support/assets/i.jpg");
    expect(localImagePath("https://x/i.png", "/docs/x.md")).toBeNull();
    expect(localImagePath("assets/a.png", null)).toBeNull();
  });
});

describe("exportPdf images", () => {
  it("embeds each picture read from disk, not through the webview", async () => {
    document.body.innerHTML =
      '<div data-active-tab="true"><div class="milkdown"><p><img src="asset://localhost/x" data-doc-src="assets/a.jpg"></p></div></div>';
    mocks.exportDoc.exportSaveDialog.mockResolvedValue("/tmp/a.pdf");
    mocks.exportDoc.exportPdfNative.mockResolvedValue(undefined);
    mocks.fs.readBinaryFileBase64.mockResolvedValue("QUJD");
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 10 });

    await exportPdf({ id: "1", path: "/docs/a.md" } as DocTab, {
      exportFailedTitle: "",
      pdfFailed: "",
      pdfPreparing: "",
    } as Strings);

    expect(mocks.fs.readBinaryFileBase64).toHaveBeenCalledWith(
      "/docs/assets/a.jpg",
    );
    const { html } = mocks.exportDoc.exportPdfNative.mock.calls.at(-1)![0];
    expect(html).toContain('src="data:image/jpeg;base64,QUJD"');
    expect(html).not.toContain("asset://");
    expect(html).not.toContain("data-doc-src");
  });
});
