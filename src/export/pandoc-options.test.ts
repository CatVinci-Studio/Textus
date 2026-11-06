import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../prefs/settings-types";
import { pandocOptions } from "./pandoc-options";

describe("pandocOptions", () => {
  it("puts the arguments for every format before the format's own", () => {
    const options = pandocOptions(
      {
        ...DEFAULT_SETTINGS,
        exportToc: true,
        exportBibliography: "/r/refs.bib",
        pandocArgs: { all: ["--toc-depth=2"], docx: ["-V", "lang=de"] },
      },
      "docx",
    );
    expect(options).toEqual({
      toc: true,
      numberSections: false,
      bibliography: "/r/refs.bib",
      csl: null,
      extraArgs: ["--toc-depth=2", "-V", "lang=de"],
    });
    expect(pandocOptions(DEFAULT_SETTINGS, "epub").extraArgs).toEqual([]);
  });
});
