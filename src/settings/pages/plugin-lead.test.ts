import { describe, expect, it } from "vitest";
import { pluginLead } from "./plugin-lead";

describe("pluginLead", () => {
  it("keeps a description's first clause", () => {
    expect(
      pluginLead(
        "Open PDFs in a tab beside your notes: pages, zoom, and text.",
      ),
    ).toBe("Open PDFs in a tab beside your notes");
    expect(pluginLead("在标签页里打开 PDF：翻页、缩放。")).toBe(
      "在标签页里打开 PDF",
    );
    expect(pluginLead("Each save kept as a version. See what changed.")).toBe(
      "Each save kept as a version",
    );
    expect(pluginLead("Pages within pages - in Obsidian's format")).toBe(
      "Pages within pages",
    );
  });

  it("reads past a time and a key shown on its own", () => {
    expect(pluginLead("Write (@2026-11-02 09:00) in a line: reminded.")).toBe(
      "Write (@2026-11-02 09:00) in a line",
    );
    expect(pluginLead("Type / for headings, : for emoji. More.")).toBe(
      "Type / for headings, : for emoji",
    );
  });

  it("keeps a short one whole, and a dot inside a name", () => {
    expect(pluginLead("Sheet music from ABC notation.")).toBe(
      "Sheet music from ABC notation.",
    );
    expect(pluginLead("Simple charts from a Chart.js configuration.")).toBe(
      "Simple charts from a Chart.js configuration.",
    );
  });
});
