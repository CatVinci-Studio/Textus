import { describe, expect, it } from "vitest";
import { dropPointInPage, sortDroppedPaths } from "./dropped-files";

describe("sortDroppedPaths", () => {
  it("opens text files and inserts images", () => {
    expect(
      sortDroppedPaths([
        "C:\\Users\\me\\notes.md",
        "C:\\Users\\me\\shot.PNG",
        "/home/me/todo.txt",
        "/home/me/图/photo.jpeg",
        "/home/me/README",
      ]),
    ).toEqual({
      documents: [
        "C:\\Users\\me\\notes.md",
        "/home/me/todo.txt",
        "/home/me/README",
      ],
      images: ["C:\\Users\\me\\shot.PNG", "/home/me/图/photo.jpeg"],
    });
  });

  it("skips empty paths", () => {
    expect(sortDroppedPaths(["", "/a.md"])).toEqual({
      documents: ["/a.md"],
      images: [],
    });
  });
});

describe("dropPointInPage", () => {
  it("scales Windows' physical pixels down to CSS pixels", () => {
    expect(dropPointInPage({ x: 300, y: 150 }, true, 1.5)).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("keeps logical coordinates as they are", () => {
    expect(dropPointInPage({ x: 300, y: 150 }, false, 2)).toEqual({
      x: 300,
      y: 150,
    });
  });
});
