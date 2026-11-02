import { describe, expect, it } from "vitest";
import { genreLabel, PAPER_GENRES } from "./paper-genres";
import en from "../../i18n/locales/en";

describe("Research mode's genres", () => {
  it("offers each genre once, each with a name of its own", () => {
    expect(new Set(PAPER_GENRES).size).toBe(PAPER_GENRES.length);
    const names = PAPER_GENRES.map((g) => genreLabel(en, g));
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
