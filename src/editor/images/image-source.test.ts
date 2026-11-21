import { describe, expect, it } from "vitest";
import { imageSource } from "./image-source";

describe("imageSource", () => {
  it("reads a file: URL as the local file it names", () => {
    expect(
      imageSource("file:///D:/notes/local%20space.png", "D:/notes/a.md"),
    ).toEqual({
      kind: "file",
      path: "D:/notes/local space.png",
      rooted: false,
    });
    expect(imageSource("file:///Users/me/a.png", "/Users/me/a.md")).toEqual({
      kind: "file",
      path: "/Users/me/a.png",
      rooted: false,
    });
  });

  it("never reads another host's file: URL", () => {
    expect(imageSource("file://server/share/a.png", "/Users/me/a.md")).toEqual({
      kind: "other",
    });
  });
});
