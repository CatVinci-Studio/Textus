// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  findEntryElement,
  foldText,
  harvestPage,
  matchEntries,
} from "./settings-search";

const PAGE = `
  <section class="settings-group">
    <h2 class="settings-group-title">Theme</h2>
    <div class="settings-group-body">
      <div class="settings-row">
        <div class="settings-row-text">
          <div class="settings-row-label">
            Diagram engine
            <span class="info-tip">
              <button class="info-tip-button">?</button>
              <span class="info-tip-description" hidden>Pele is faster.</span>
            </span>
          </div>
        </div>
      </div>
      <label class="settings-row"><div class="settings-row-label"><span>Résumé mode</span></div></label>
      <button class="settings-row settings-link-row"><span class="settings-row-label">Ｍore themes</span></button>
    </div>
  </section>
  <details class="settings-advanced">
    <summary>Advanced</summary>
    <label class="settings-row"><div class="settings-row-label"><span>编辑动画</span></div></label>
  </details>
  <section class="shortcut-fixed-section">
    <h3 class="shortcut-fixed-title">File</h3>
    <dl><div class="shortcut-fixed-row"><dt>Save</dt><dd><kbd>Ctrl+S</kbd></dd></div></dl>
  </section>
`;

function page() {
  const root = document.createElement("div");
  root.innerHTML = PAGE;
  return root;
}

describe("settings search", () => {
  it("folds case, accents and full-width forms but keeps kana voicing", () => {
    expect(foldText("Résumé")).toBe("resume");
    expect(foldText("ＣＳＳ")).toBe("css");
    expect(foldText("が")).not.toBe(foldText("か"));
  });

  it("reads rows, group titles and the hidden ? text from a page", () => {
    const entries = harvestPage(page(), "editor");
    expect(entries).toEqual([
      { page: "editor", kind: "group", label: "Theme", group: "", help: "" },
      {
        page: "editor",
        kind: "row",
        label: "Diagram engine",
        group: "Theme",
        help: "Pele is faster.",
      },
      expect.objectContaining({ label: "Résumé mode", group: "Theme" }),
      expect.objectContaining({ label: "Ｍore themes", group: "Theme" }),
      expect.objectContaining({ kind: "group", label: "Advanced" }),
      expect.objectContaining({ label: "编辑动画", group: "Advanced" }),
      expect.objectContaining({ label: "Save", group: "File" }),
    ]);
  });

  it("matches a plain substring of a label, a group or the ? text", () => {
    const entries = harvestPage(page(), "editor");
    const labels = (q: string) =>
      matchEntries(entries, q).map((m) => [m.entry.label, m.byHelp]);
    expect(labels("resume")).toEqual([["Résumé mode", false]]);
    expect(labels("more THEMES")).toEqual([["Ｍore themes", false]]);
    expect(labels("动画")).toEqual([["编辑动画", false]]);
    expect(labels("faster")).toEqual([["Diagram engine", true]]);
    expect(labels("theme")).toEqual([
      ["Theme", false],
      ["Ｍore themes", false],
    ]);
    expect(labels("   ")).toEqual([]);
  });

  it("finds an entry's row again on the page as shown", () => {
    const root = page();
    const [, engine] = harvestPage(root, "editor");
    expect(findEntryElement(root, engine)?.textContent).toContain(
      "Diagram engine",
    );
  });
});
