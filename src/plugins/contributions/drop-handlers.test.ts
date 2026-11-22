import { afterEach, describe, expect, it } from "vitest";
import {
  addDropHandler,
  dropClaimed,
  dropMatch,
  forgetDropHandlers,
  provideDrop,
  type DroppedFileInfo,
} from "./drop-handlers";

afterEach(() => {
  forgetDropHandlers("a.one");
  forgetDropHandlers("b.two");
});

const csv: DroppedFileInfo = {
  path: "/d/rows.CSV",
  name: "rows.CSV",
  kind: "attachment",
  fromSystem: true,
  document: "/n/a.md",
};

describe("a plugin's drop handler", () => {
  it("takes the files its kinds or extensions name, and no others", () => {
    addDropHandler(
      "a.one",
      "1",
      dropMatch({ extensions: [".csv"] }),
      async () => null,
    );
    addDropHandler(
      "b.two",
      "1",
      dropMatch({ kinds: ["image"] }),
      async () => null,
    );
    expect(dropClaimed("rows.csv", "attachment")).toBe(true);
    expect(dropClaimed("boat.png", "image")).toBe(true);
    expect(dropClaimed("report.pdf", "attachment")).toBe(false);
  });

  it("names something it takes", () => {
    expect(() => dropMatch({})).toThrow();
    expect(() => dropMatch({ kinds: "image" })).toThrow();
  });

  it("answers in plugin id order; null lets the next, then Textus, write it", async () => {
    addDropHandler(
      "b.two",
      "1",
      dropMatch({ extensions: ["csv"] }),
      async (f) => `| ${f.name} |`,
    );
    addDropHandler(
      "a.one",
      "1",
      dropMatch({ extensions: ["csv"] }),
      async () => null,
    );
    expect(await provideDrop(csv)).toBe("| rows.CSV |");
    forgetDropHandlers("b.two");
    expect(await provideDrop(csv)).toBeNull();
  });
});
