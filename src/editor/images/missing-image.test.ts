import { describe, expect, it } from "vitest";
import {
  imageDisplayName,
  imageLocation,
  missingReason,
  nearestExisting,
} from "./missing-image";

describe("where a missing image was looked for", () => {
  it("resolves a relative src against the document's folder", () => {
    expect(imageLocation("assets/cat%20one.png", "/notes/trip.md")).toEqual({
      kind: "local",
      path: "/notes/assets/cat one.png",
    });
  });

  it("folds ../ away, so the tooltip names the real folder", () => {
    expect(imageLocation("../img/a.png", "/notes/deep/trip.md")).toEqual({
      kind: "local",
      path: "/notes/img/a.png",
    });
  });

  it("keeps an absolute path and a Windows drive path as they are", () => {
    expect(imageLocation("/pics/a.png", "/notes/trip.md")).toEqual({
      kind: "local",
      path: "/pics/a.png",
    });
    expect(imageLocation("C:\\pics\\a.png", null)).toEqual({
      kind: "local",
      path: "C:\\pics\\a.png",
    });
  });

  it("reads an http(s) src as remote, with its host", () => {
    expect(
      imageLocation("https://img.example.com:8080/a.png?x=1", "/n/t.md"),
    ).toEqual({
      kind: "remote",
      url: "https://img.example.com:8080/a.png?x=1",
      host: "img.example.com:8080",
    });
  });

  it("has nowhere to look for a relative src before the document is saved", () => {
    expect(imageLocation("assets/a.png", null)).toEqual({ kind: "unsaved" });
  });

  it("leaves other schemes and iOS Files documents to a generic reason", () => {
    expect(imageLocation("data:image/png;base64,xx", "/n/t.md")).toEqual({
      kind: "other",
    });
    expect(
      imageLocation("a.png", "file:///private/var/mobile/Docs/t.md"),
    ).toEqual({ kind: "other" });
  });
});

describe("why a missing image didn't load", () => {
  const local = { kind: "local", path: "/n/a.png" } as const;

  it("says a local file isn't there when the backend finds nothing", () => {
    expect(missingReason(local, false)).toBe("notFound");
  });

  it("says a file that is there can't be shown", () => {
    expect(missingReason(local, true)).toBe("unsupported");
  });

  it("falls back to a generic reason when the backend couldn't say", () => {
    expect(missingReason(local, null)).toBe("failed");
  });

  it("blames the remote host for a web image", () => {
    expect(
      missingReason({ kind: "remote", url: "https://x/a", host: "x" }, null),
    ).toBe("remote");
  });

  it("asks for a save when the document has no folder yet", () => {
    expect(missingReason({ kind: "unsaved" }, null)).toBe("unsaved");
  });
});

describe("the name a missing image goes by", () => {
  it("is the file name, decoded", () => {
    expect(imageDisplayName("assets/%E5%9B%BE%201.png")).toBe("图 1.png");
    expect(imageDisplayName("C:\\pics\\a.png")).toBe("a.png");
  });

  it("is the last part of a web address, or its host", () => {
    expect(imageDisplayName("https://x.org/img/cat.png?s=1")).toBe("cat.png");
    expect(imageDisplayName("https://x.org/")).toBe("x.org");
  });
});

describe("the folder Show in folder opens", () => {
  it("is the nearest folder above the image that exists", async () => {
    const existing = new Set(["/notes", "/"]);
    const found = await nearestExisting("/notes/assets/sub/a.png", (p) =>
      Promise.resolve(existing.has(p)),
    );
    expect(found).toBe("/notes");
  });

  it("is the image itself when it is there", async () => {
    const found = await nearestExisting("/notes/a.heic", () =>
      Promise.resolve(true),
    );
    expect(found).toBe("/notes/a.heic");
  });

  it("is nothing when not even the root can be found", async () => {
    expect(
      await nearestExisting("/a/b.png", () => Promise.resolve(false)),
    ).toBeNull();
  });
});
