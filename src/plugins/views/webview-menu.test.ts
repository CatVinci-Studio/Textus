import { describe, expect, it } from "vitest";
import { pageMenuEntries } from "./webview-menu";

describe("a plugin page's menu", () => {
  it("becomes the app's menu entries, choosing an item's value or label", () => {
    const chosen: unknown[] = [];
    const entries = pageMenuEntries(
      [
        { label: "Sort ascending", value: "asc" },
        "separator",
        { label: "Delete", danger: true },
        { label: "Type", items: [{ label: "Text", checked: true }] },
        { nope: 1 },
        "junk",
      ],
      (v) => chosen.push(v),
    );
    expect(entries).toHaveLength(4);
    const [first, sep, del, group] = entries as never[];
    expect(sep).toBe("separator");
    (first as { onSelect: () => void }).onSelect();
    (del as { onSelect: () => void }).onSelect();
    expect(chosen).toEqual(["asc", "Delete"]);
    expect((del as { danger: boolean }).danger).toBe(true);
    expect((group as { items: { checked: boolean }[] }).items[0].checked).toBe(
      true,
    );
  });

  it("reads nothing from what isn't a list", () => {
    expect(pageMenuEntries("x", () => {})).toEqual([]);
  });
});
