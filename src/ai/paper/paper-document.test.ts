import { describe, expect, it } from "vitest";
import { paperDraft, sectionBody, withoutPictures } from "./paper-document";
import type { Outline } from "../../platform/bindings/ai-paper";

const outline = {
  thesis: "Green roofs cool cities.",
  sections: [
    {
      title: "How roofs cool",
      keyPoints: [],
      notes: [],
      targetWords: 100,
      figures: [],
    },
    {
      title: "What it costs",
      keyPoints: [],
      notes: [],
      targetWords: 100,
      figures: [],
    },
  ],
} as unknown as Outline;

describe("the paper as it is written", () => {
  it("shows every section's heading, and what each writer has so far", () => {
    expect(
      paperDraft("Green roofs", outline, {
        0: "Plants shade [1](https://a.example).",
      }),
    ).toBe(
      "# Green roofs\n\n## How roofs cool\n\nPlants shade [1](https://a.example).\n\n## What it costs",
    );
  });

  it("gives a kept section the paper's heading, not its own", () => {
    expect(sectionBody("## How roofs cool\n\nPlants shade.")).toBe(
      "Plants shade.",
    );
  });

  it("closes a chart or figure mark still being written", () => {
    expect(sectionBody('Below.\n\n```chart\n{"type": "ba')).toBe(
      'Below.\n\n```chart\n{"type": "ba\n```',
    );
    expect(sectionBody("Below.\n\n<!-- textus-figure web: Roo")).toBe("Below.");
    expect(
      sectionBody("<!-- textus-figure web: Roof | roof -->\n\nAfter."),
    ).toBe("<!-- textus-figure web: Roof | roof -->\n\nAfter.");
  });

  it("is written first without its pictures, their captions kept", () => {
    expect(
      withoutPictures(
        "Text.\n\n![Roof](textus-generated:ab12)\n\n*Figure 1. Roof*\n\nMore.",
      ),
    ).toBe("Text.\n\n*Figure 1. Roof*\n\nMore.");
  });
});
