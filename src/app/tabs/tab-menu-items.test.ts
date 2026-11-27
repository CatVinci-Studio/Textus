// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { documentTabMenu } from "./tab-menu-items";
import type { DocTab } from "../../document/doc-tabs";
import type { ContextMenuEntry } from "../../engine/controls/ContextMenu";

vi.mock("../../platform/window-folder", () => ({
  windowFolder: () => "/notes",
}));

const tab = { id: "a", path: "/notes/a.md", content: "" } as unknown as DocTab;
const labels = (entries: ContextMenuEntry[]) =>
  entries.map((e) => (e === "separator" ? "—" : e.label));

it("keeps a tab's first group short: its path ways behind one row", () => {
  const menu = documentTabMenu({
    tabs: [tab],
    activeTabId: "a",
    onActivate: () => {},
    onClose: () => {},
    onToggleReadOnly: () => {},
    onPin: () => {},
    t: en,
  })("a", [tab]);
  const first = labels(menu).slice(0, labels(menu).indexOf("—"));
  expect(first).toEqual([
    en.menuFileLocation,
    en.menuToggleReadOnly,
    en.menuPinTab,
  ]);
  const location = menu[0] as { items: ContextMenuEntry[] };
  expect(labels(location.items)).toEqual(
    expect.arrayContaining([
      en.menuCopyPath,
      en.menuCopyRelativePath,
      en.menuRevealInTree,
    ]),
  );
});
