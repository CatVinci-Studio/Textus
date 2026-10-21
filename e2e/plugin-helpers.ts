import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { openApp } from "./helpers";

/** A Word document of one paragraph, base64. */
export async function minimalDocx(text: string): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "base64" });
}

// For the official plugins' flows (official-plugins.spec.ts): the window
// with plugins already on, files to open, and the frame of a plugin's tab.

/** A 1×1 PNG. */
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

export async function openWithPlugins(
  page: Page,
  options: {
    plugins: Record<string, string[]>;
    binary?: Record<string, string>;
    folder?: Record<string, string>;
    files?: Record<string, string>;
    language?: string;
  },
) {
  await page.addInitScript((o) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    // Installed from the catalog (the textus-plugins checkout the dev
    // server serves), on, with these grants.
    w.__devCatalogInstalled = Object.keys(o.plugins);
    w.__devPluginState = {
      allOn: true,
      plugins: Object.fromEntries(
        Object.entries(o.plugins).map(([id, granted]) => [
          id,
          { enabled: true, granted, official: true },
        ]),
      ),
    };
    w.__devBinaryFiles = o.binary ?? {};
    if (o.folder) w.__devFs = o.folder;
    if (o.files) w.__devFiles = o.files;
  }, options);
  await openApp(page, { settings: { language: options.language ?? "en" } });
}

/** Opens `path` as Open Recent would. */
export const openPath = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-open-recent", p),
    path,
  );

/** Opens the sidebar on the tab called `name`; its plugin's frame. */
export async function openSidebarTab(page: Page, name: string) {
  if (await page.locator(".sidebar.sidebar-collapsed").count())
    await page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-toggle-sidebar"),
    );
  await page.locator(".sidebar-tabs").getByRole("button", { name }).click();
  return page.frameLocator(".sidebar .plugin-webview-frame");
}

/** The frame of the plugin's tab in front. */
export const tabFrame = (page: Page) =>
  page.frameLocator('[data-active-tab="true"] .plugin-webview-frame');

/** A one-page PDF saying `text`, base64 - built by hand, with its
 *  cross-reference table, so a test needs no fixture file. */
export function minimalPdf(text: string): string {
  const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1").toString("base64");
}
