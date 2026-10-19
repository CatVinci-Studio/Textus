import { describe, expect, it } from "vitest";
import { savesAndCloses, type QuickNoteKey } from "./keys";

const key = (k: string, extra: Partial<QuickNoteKey> = {}): QuickNoteKey => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 0,
  ...extra,
});

const idle = {
  composing: false,
  findOpen: false,
  popoverOpen: false,
  mac: false,
};

describe("savesAndCloses", () => {
  it("saves on Escape, Ctrl+Enter, Ctrl+S and Ctrl+W", () => {
    expect(savesAndCloses(key("Escape"), idle)).toBe(true);
    for (const k of ["Enter", "s", "w", "S"])
      expect(savesAndCloses(key(k, { ctrlKey: true }), idle), k).toBe(true);
  });

  it("uses ⌘ on a Mac, where Ctrl+S is not a save", () => {
    const mac = { ...idle, mac: true };
    expect(savesAndCloses(key("s", { metaKey: true }), mac)).toBe(true);
    expect(savesAndCloses(key("Enter", { metaKey: true }), mac)).toBe(true);
    expect(savesAndCloses(key("s", { ctrlKey: true }), mac)).toBe(false);
  });

  it("leaves other keys and combinations to the editor", () => {
    expect(savesAndCloses(key("Enter"), idle)).toBe(false);
    expect(savesAndCloses(key("s"), idle)).toBe(false);
    expect(
      savesAndCloses(key("s", { ctrlKey: true, shiftKey: true }), idle),
    ).toBe(false);
    expect(savesAndCloses(key("b", { ctrlKey: true }), idle)).toBe(false);
  });

  it("never fires while an input method is composing, however WebKit says so", () => {
    for (const composing of [
      key("Escape", { isComposing: true }),
      key("Escape", { keyCode: 229 }),
      key("Enter", { ctrlKey: true, keyCode: 229 }),
    ])
      expect(savesAndCloses(composing, idle)).toBe(false);
    expect(savesAndCloses(key("Escape"), { ...idle, composing: true })).toBe(
      false,
    );
  });

  it("lets Escape close the find bar or a popover first", () => {
    expect(savesAndCloses(key("Escape"), { ...idle, findOpen: true })).toBe(
      false,
    );
    expect(savesAndCloses(key("Escape"), { ...idle, popoverOpen: true })).toBe(
      false,
    );
    // Ctrl+S still saves with the find bar open.
    expect(
      savesAndCloses(key("s", { ctrlKey: true }), { ...idle, findOpen: true }),
    ).toBe(true);
  });
});
