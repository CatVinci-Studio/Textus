import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** The runtime's text.js, as the host frame runs it. */
const text: any = new Function(
  `${readFileSync(new URL("./text.js", import.meta.url), "utf8")}; return __textusText;`,
)();

/** {{key}} and {{key:FORMAT}} filled in from values (runtime/text.js). */
const fillTemplate: (
  text: string,
  values: Record<string, unknown>,
  options?: { now?: Date; language?: string; dateFormat?: string },
) => string = (t, values, options) =>
  text.dates.fill(t, { ...options, values });

describe("a filled template", () => {
  it("has each known {{key}} replaced, lists joined, null as nothing", () => {
    expect(
      fillTemplate("# {{title}}\n{{ authors }} ({{year}}){{doi}}", {
        title: "Attention",
        authors: ["Ashish Vaswani", "Noam Shazeer"],
        year: 2017,
        doi: null,
      }),
    ).toBe("# Attention\nAshish Vaswani, Noam Shazeer (2017)");
  });

  it("keeps a key it has no value for as written", () => {
    expect(
      fillTemplate("{{title}} {{unknown}} {{other:YYYY}}", { title: "A" }),
    ).toBe("A {{unknown}} {{other:YYYY}}");
  });

  it("writes a date value in the format a key names", () => {
    const values = {
      added: "2024-03-05T10:00:00",
      published: "2017-06-12",
      year: "2017",
    };
    expect(
      fillTemplate(
        "{{added:DD/MM/YYYY}} {{published:MMMM YYYY}} {{year:YY}}",
        values,
      ),
    ).toBe("05/03/2024 June 2017 17");
  });

  it("leaves a format on text that isn't a date as written", () => {
    expect(fillTemplate("{{title:YYYY}}", { title: "Attention" })).toBe(
      "{{title:YYYY}}",
    );
  });

  it("gives {{date}} and {{time}} from now unless the values have them", () => {
    const now = new Date(2026, 10, 7, 9, 5);
    expect(fillTemplate("{{date}} {{time}} {{date:YYYY}}", {}, { now })).toBe(
      "2026-11-07 09:05 2026",
    );
    expect(fillTemplate("{{date}}", { date: "2017" }, { now })).toBe("2017");
  });
});
