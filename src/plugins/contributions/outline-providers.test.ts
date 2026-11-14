import { afterEach, describe, expect, it } from "vitest";
import {
  addOutlineProvider,
  askOutline,
  removeOutlineProvider,
} from "./outline-providers";

afterEach(() => {
  removeOutlineProvider("a.one");
  removeOutlineProvider("b.two");
});

describe("plugins' outline rows", () => {
  it("come in plugin id order, levels kept 1 to 6, bad rows left out", async () => {
    addOutlineProvider("b.two", async () => [{ text: "Act I", block: "x" }]);
    addOutlineProvider("a.one", async () => [
      { text: "INT. KITCHEN", block: "k", level: 9 },
      { text: "no block" },
      "nonsense",
    ]);
    expect(await askOutline([])).toEqual([
      { text: "INT. KITCHEN", block: "k", level: 6, plugin: "a.one" },
      { text: "Act I", block: "x", level: 1, plugin: "b.two" },
    ]);
  });

  it("leave out a plugin that fails", async () => {
    addOutlineProvider("a.one", () => Promise.reject(new Error("no")));
    expect(await askOutline([])).toEqual([]);
  });
});
