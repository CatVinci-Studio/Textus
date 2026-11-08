import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** The runtime's text.js, as the host frame runs it. */
const text: any = new Function(
  `${readFileSync(new URL("./text.js", import.meta.url), "utf8")}; return __textusText;`,
)();

/** Templater's tags, as textus.templates fills them (runtime/text.js). */
type Filled = { text: string; cursor: number | null; skipped: string[] };
const tp: {
  fill: (
    text: string,
    c: {
      title: string;
      folder: string;
      now: Date;
      language?: string;
      created?: Date;
    },
  ) => Filled;
  place: (doc: string, at: number) => { line: number; text?: string };
} = text.templater;

// Saturday, 2026-11-07, 09:03.
const c = {
  title: "Plan",
  folder: "Work/Q4",
  now: new Date(2026, 10, 7, 9, 3),
  language: "en",
};
const fill = (text: string) => tp.fill(text, c);

describe("Templater's tags", () => {
  it("fill in dates, with formats and offsets", () => {
    expect(
      fill(
        '<% tp.date.now("YYYY-MM-DD") %> <% tp.date.now() %> <% tp.date.now("ddd", -1) %>',
      ).text,
    ).toBe("2026-11-07 2026-11-07 Fri");
    expect(
      fill(
        "<% tp.date.now('YYYY-MM-DD', \"P1W\") %> <% tp.date.now('MMM', '-P1M') %>",
      ).text,
    ).toBe("2026-11-14 Oct");
    expect(
      fill(
        '<% tp.date.today("Do") %> <% tp.date.tomorrow() %> <% tp.date.yesterday("D") %>',
      ).text,
    ).toBe("7th 2026-11-08 6");
  });

  it("fill in the file's title, folder and creation date", () => {
    expect(
      fill(
        "# <% tp.file.title %>\n<% tp.file.folder() %> <% tp.file.folder(true) %>",
      ).text,
    ).toBe("# Plan\nQ4 Work/Q4");
    expect(
      tp.fill("<% tp.file.folder(true) %>|<% tp.file.folder() %>", {
        ...c,
        folder: "",
      }).text,
    ).toBe("/|");
    expect(fill("<% tp.file.creation_date() %>").text).toBe("2026-11-07 09:03");
    expect(
      tp.fill('<% tp.file.creation_date("YYYY") %>', {
        ...c,
        created: new Date(2020, 0, 1),
      }).text,
    ).toBe("2020");
  });

  it("take the line break beside a tag with - and every space with _", () => {
    expect(fill("a\n<%- tp.file.title -%>\nb").text).toBe("aPlanb");
    expect(fill("a  \n\n<%_ tp.file.title _%>  \n c").text).toBe("aPlanc");
  });

  it("leave scripts and other tags as written, and say which", () => {
    const text =
      '<%* tR += "x" %> <% tp.system.prompt("Name") %> <% tp.date.now(fmt) %> <% tp.file.title() %> <% tp.date.now("Y", 0, "2020-01-01") %> <% tp.file.title %>';
    const out = fill(text);
    expect(out.text).toBe(text.replace("<% tp.file.title %>", "Plan"));
    expect(out.skipped).toEqual([
      '<%* tR += "x" %>',
      '<% tp.system.prompt("Name") %>',
      "<% tp.date.now(fmt) %>",
      "<% tp.file.title() %>",
      '<% tp.date.now("Y", 0, "2020-01-01") %>',
    ]);
  });

  it("mark the caret at the lowest numbered cursor", () => {
    const out = fill(
      "# <% tp.file.title %>\n\n<% tp.file.cursor(2) %>Notes\n- <% tp.file.cursor(1) %>",
    );
    expect(out.text).toBe("# Plan\n\nNotes\n- ");
    expect(out.cursor).toBe(out.text.length);
    expect(fill("no cursor").cursor).toBeNull();
  });
});

it("finds a caret's line, and the plain words after it when they are found once", () => {
  const doc = "# Plan\n\nNotes here\n- \n";
  expect(tp.place(doc, doc.indexOf("Notes"))).toEqual({
    line: 2,
    text: "Notes here",
  });
  expect(tp.place(doc, doc.indexOf("- ") + 2)).toEqual({ line: 3 });
  expect(tp.place("a\na\n", 2)).toEqual({ line: 1 });
});
