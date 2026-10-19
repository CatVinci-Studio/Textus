import { describe, expect, it } from "vitest";
import { chooseStart, localStamp } from "./start";
import type { QuickNoteLast } from "../platform/ipc";

const NOW = Date.UTC(2026, 9, 19, 14, 32);
const minutesAgo = (m: number) => NOW - m * 60_000;

const fileNote = (savedAtMs: number): QuickNoteLast => ({
  path: "/notes/Idea.md",
  heading: null,
  text: "Idea",
  savedAtMs,
});

describe("chooseStart", () => {
  it("continues the last note within the window", () => {
    expect(
      chooseStart(
        { draft: null, last: fileNote(minutesAgo(4)) },
        NOW,
        5,
        false,
      ),
    ).toEqual({
      kind: "continue",
      text: "Idea",
      target: { path: "/notes/Idea.md", heading: null, base: "Idea" },
    });
  });

  it("starts a new note once the window has passed", () => {
    expect(
      chooseStart(
        { draft: null, last: fileNote(minutesAgo(6)) },
        NOW,
        5,
        false,
      ),
    ).toEqual({ kind: "blank" });
  });

  it("always starts a new note with the window at 0", () => {
    expect(
      chooseStart({ draft: null, last: fileNote(NOW) }, NOW, 0, false),
    ).toEqual({ kind: "blank" });
  });

  it("does not take a clock set back for a moment ago", () => {
    expect(
      chooseStart({ draft: null, last: fileNote(NOW + 60_000) }, NOW, 5, false)
        .kind,
    ).toBe("blank");
  });

  it("starts afresh when the kind of note changed in Settings", () => {
    const entry: QuickNoteLast = {
      ...fileNote(minutesAgo(1)),
      path: "/notes/2026-10-19.md",
      heading: "## 14:31",
    };
    expect(chooseStart({ draft: null, last: entry }, NOW, 5, false).kind).toBe(
      "blank",
    );
    expect(chooseStart({ draft: null, last: entry }, NOW, 5, true)).toEqual({
      kind: "continue",
      text: "Idea",
      target: {
        path: "/notes/2026-10-19.md",
        heading: "## 14:31",
        base: "Idea",
      },
    });
  });

  it("restores a draft before anything else", () => {
    const draft = { text: "Unsaved words", target: null };
    expect(
      chooseStart({ draft, last: fileNote(minutesAgo(1)) }, NOW, 5, false),
    ).toEqual({ kind: "draft", text: "Unsaved words", target: null });
    expect(
      chooseStart(
        { draft: { text: "  \n", target: null }, last: null },
        NOW,
        5,
        false,
      ).kind,
    ).toBe("blank");
  });
});

describe("localStamp", () => {
  it("reads the local clock with zero padding and no seconds", () => {
    expect(localStamp(new Date(2026, 0, 5, 9, 7, 59))).toEqual({
      date: "2026-01-05",
      time: "09:07",
    });
  });
});
