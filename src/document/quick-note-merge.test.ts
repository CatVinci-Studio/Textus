import { describe, expect, it } from "vitest";
import { joinEntry, notePreview, syncWithQuickNote } from "./quick-note-merge";

const DAY = "## 09:00\n\nMorning\n";
const ENTRY = "## 14:32\n\nAfternoon\n";
const AFTER = `${DAY}\n${ENTRY}`;

describe("joinEntry", () => {
  it("leaves one blank line before the entry, as the file got it", () => {
    expect(joinEntry(DAY, ENTRY)).toBe(AFTER);
    expect(joinEntry("Top", ENTRY)).toBe(`Top\n\n${ENTRY}`);
    expect(joinEntry("Top\n\n\n", ENTRY)).toBe(`Top\n\n${ENTRY}`);
    expect(joinEntry("", ENTRY)).toBe(ENTRY);
  });
});

describe("syncWithQuickNote", () => {
  it("reloads a tab without unsaved edits", () => {
    expect(
      syncWithQuickNote(
        { content: DAY, savedContent: DAY },
        { after: AFTER, entry: ENTRY },
      ),
    ).toEqual({ kind: "reload" });
  });

  it("merges an appended entry into unsaved edits when disk is saved + entry", () => {
    const typed = `${DAY}\nA thought typed in the editor\n`;
    expect(
      syncWithQuickNote(
        { content: typed, savedContent: DAY },
        { after: AFTER, entry: ENTRY },
      ),
    ).toEqual({
      kind: "merge",
      content: `${DAY}\nA thought typed in the editor\n\n${ENTRY}`,
      savedContent: AFTER,
    });
  });

  it("reads the file's CRLF and BOM the way the tab does", () => {
    const crlf = `\ufeff${AFTER.replace(/\n/g, "\r\n")}`;
    expect(
      syncWithQuickNote(
        { content: `${DAY}x\n`, savedContent: DAY },
        { after: crlf, entry: ENTRY.replace(/\n/g, "\r\n") },
      ).kind,
    ).toBe("merge");
  });

  it("never merges when the file changed in another way too", () => {
    // Someone else edited the file since this tab read it.
    const elsewhere = `## 09:00\n\nMorning, edited elsewhere\n\n${ENTRY}`;
    expect(
      syncWithQuickNote(
        { content: `${DAY}typed\n`, savedContent: DAY },
        { after: elsewhere, entry: ENTRY },
      ),
    ).toEqual({ kind: "conflict" });
    // A continued note rewrote its entry in place: no entry to append.
    expect(
      syncWithQuickNote(
        { content: `${DAY}typed\n`, savedContent: DAY },
        { after: "## 09:00\n\nMorning, continued\n", entry: null },
      ),
    ).toEqual({ kind: "conflict" });
  });

  it("does nothing when the file already reads as the tab saved it", () => {
    expect(
      syncWithQuickNote(
        { content: "edited", savedContent: AFTER },
        { after: AFTER, entry: ENTRY },
      ),
    ).toEqual({ kind: "unchanged" });
  });
});

describe("notePreview", () => {
  it("shows the note's words without its time heading", () => {
    expect(notePreview(ENTRY)).toBe("Afternoon");
    expect(notePreview("a ".repeat(100), 10)).toBe("a a a a a…");
  });
});
