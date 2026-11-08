import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** The runtime's text.js, as the host frame runs it. */
const text: any = new Function(
  `${readFileSync(new URL("./text.js", import.meta.url), "utf8")}; return __textusText;`,
)();

/** Moment-style dates and template filling (runtime/text.js: textus.dates). */
const dates: {
  format: (d: Date, format: string, language?: string) => string;
  day: (d: Date) => string;
  parse: (text: string, format: string, language?: string) => string | null;
  fill: (
    text: string,
    options: {
      day?: Date;
      now?: Date;
      language?: string;
      values?: Record<string, string>;
    },
  ) => string;
} = text.dates;

it("writes and reads back the formats daily notes are named by", () => {
  const day = new Date(2026, 10, 2, 9, 5);
  expect(dates.format(day, "YYYY-MM-DD")).toBe("2026-11-02");
  expect(dates.day(new Date(2026, 0, 7, 23, 59))).toBe("2026-01-07");
  expect(dates.format(day, "YYYY/MM/D [at] HH:mm")).toBe("2026/11/2 at 09:05");
  expect(dates.format(day, "dddd, MMMM D", "en")).toBe("Monday, November 2");
  expect(dates.parse("2026/11/2026-11-02", "YYYY/MM/YYYY-MM-DD")).toBe(
    "2026-11-02",
  );
  expect(dates.parse("02.11.2026", "DD.MM.YYYY")).toBe("2026-11-02");
  expect(dates.parse("2026-02-30", "YYYY-MM-DD")).toBe(null);
  expect(dates.parse("notes", "YYYY-MM-DD")).toBe(null);
});

it("writes Moment's ordinals, weeks, quarters and 12-hour times as Obsidian does", () => {
  const day = new Date(2026, 10, 2, 21, 5);
  expect(dates.format(day, "MMMM Do, YYYY", "en")).toBe("November 2nd, 2026");
  expect(
    [1, 11, 22, 23, 31].map((d) => dates.format(new Date(2026, 0, d), "Do")),
  ).toEqual(["1st", "11th", "22nd", "23rd", "31st"]);
  expect(dates.format(day, "Do", "zh")).toBe("2日");
  expect(dates.format(day, "h:mm A, hh a, [Q]Q")).toBe("9:05 PM, 09 pm, Q4");
  expect(dates.format(new Date(2026, 0, 1, 0, 30), "h A")).toBe("12 AM");
  // ISO weeks (W, GGGG), and locale weeks (w, gggg): Sunday-first with the
  // week of January 1st first in English, ISO's elsewhere.
  expect(dates.format(new Date(2027, 0, 1), "GGGG-[W]WW")).toBe("2026-W53");
  expect(dates.format(new Date(2027, 0, 1), "gggg-[W]ww", "en")).toBe(
    "2027-W01",
  );
  expect(dates.format(new Date(2027, 0, 1), "gggg-[W]ww", "de")).toBe(
    "2026-W53",
  );
  expect(dates.format(new Date(2026, 10, 1), "gggg-[W]ww w", "en")).toBe(
    "2026-W45 45",
  );
  expect(dates.format(new Date(2026, 10, 1), "W", "de")).toBe("44");
});

it("reads names with month names, ordinals and other tokens back", () => {
  expect(dates.parse("November 2nd, 2026", "MMMM Do, YYYY")).toBe("2026-11-02");
  expect(dates.parse("Monday, Nov 2 2026", "dddd, MMM D YYYY")).toBe(
    "2026-11-02",
  );
  expect(dates.parse("2026年十一月2日", "YYYY[年]MMMMDo", "zh")).toBe(
    "2026-11-02",
  );
  expect(dates.parse("2026-11-02 W45", "YYYY-MM-DD [W]WW")).toBe("2026-11-02");
  expect(dates.parse("2026-W45", "gggg-[W]ww")).toBe(null);
});

describe("a template filled in", () => {
  it("writes {{date}} and {{time}} in the formats given, and moves {{date+1d}}", () => {
    const now = new Date(2026, 10, 5, 14, 7);
    const options = { now, dateFormat: "DD.MM.YYYY", timeFormat: "h:mm A" };
    expect(dates.fill("{{date}} {{time}} {{date:YYYY}}", options)).toBe(
      "05.11.2026 2:07 PM 2026",
    );
    expect(
      dates.fill(
        "{{date+1d}} {{date-1M:YYYY-MM}} {{date+1w:D}} {{time+2h}}",
        options,
      ),
    ).toBe("06.11.2026 2026-10 12 4:07 PM");
  });

  const now = new Date(2026, 10, 5, 14, 7);

  it("takes the date of the day given and the time of now", () => {
    const text =
      "{{date}} {{time}} {{date:dddd D MMMM}} {{time:H.mm}} {{title}}";
    expect(
      dates.fill(text, {
        day: new Date(2026, 0, 2),
        now,
        language: "en",
        values: { title: "T" },
      }),
    ).toBe("2026-01-02 14:07 Friday 2 January 14.07 T");
    expect(dates.fill("{{date}} {{date:}}", { now })).toBe(
      "2026-11-05 2026-11-05",
    );
  });

  it("leaves the names it isn't given as written, and what it fills in unread", () => {
    expect(
      dates.fill("{{weekday}} {{title:x}} {{constructor}} {{title}}", {
        now,
        values: { title: "{{date}}" },
      }),
    ).toBe("{{weekday}} {{title:x}} {{constructor}} {{date}}");
  });
});

describe("weekly and monthly notes' names and templates", () => {
  const d = () => text.dates;

  it("names a note in its folder", () => {
    expect(
      d().notePath("Weekly", "gggg-[W]ww", new Date(2026, 10, 5), "en"),
    ).toBe("Weekly/2026-W45.md");
    expect(d().notePath("", "YYYY-MM", new Date(2026, 10, 5))).toBe(
      "2026-11.md",
    );
  });

  it("gives a week's days from where the language starts its weeks", () => {
    const day = (x: Date) => dates.day(x);
    const en = d().weekDays(new Date(2026, 10, 5), "en");
    expect([day(en.sunday), day(en.monday), day(en.saturday)]).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-07",
    ]);
    const de = d().weekDays(new Date(2026, 10, 1), "de");
    expect([day(de.monday), day(de.sunday)]).toEqual([
      "2026-10-26",
      "2026-11-01",
    ]);
  });

  it("fills a week's note as Periodic Notes does", () => {
    const text =
      "{{title}} {{date}} {{monday:ddd D}} {{friday}} {{monday:}}\\n";
    expect(
      d().fillNote(text, new Date(2026, 10, 5), {
        format: "gggg-[W]ww",
        language: "en",
        title: "W45",
      }),
    ).toBe("W45 2026-W45 Mon 2 2026-11-06 2026-11-02\n");
  });

  it("writes a Date it is given like {{date}}", () => {
    expect(
      dates.fill("{{start:YYYY/MM/DD}} {{start}}", {
        values: { start: new Date(2026, 0, 2) } as never,
      }),
    ).toBe("2026/01/02 2026-01-02");
  });
});
