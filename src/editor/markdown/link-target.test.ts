import { describe, expect, it } from "vitest";
import { headingSlug, linkTarget } from "./link-target";

const doc = (path: string) => ({ kind: "document", path });

describe("linkTarget", () => {
  it("resolves a relative Markdown link against the document's folder", () => {
    expect(linkTarget("./notes/ch1.md", "/home/me/index.md")).toEqual(
      doc("/home/me/notes/ch1.md"),
    );
    expect(linkTarget("notes/ch1.markdown", "/home/me/index.md")).toEqual(
      doc("/home/me/notes/ch1.markdown"),
    );
    expect(linkTarget("../other/a.MD", "/home/me/book/index.md")).toEqual(
      doc("/home/me/other/a.MD"),
    );
  });

  it("spells a link from a Windows document the way Windows does", () => {
    expect(linkTarget("./notes/ch1.md", "C:\\Users\\me\\index.md")).toEqual(
      doc("C:\\Users\\me\\notes\\ch1.md"),
    );
    expect(linkTarget("..\\b.md", "C:\\Users\\me\\a\\index.md")).toEqual(
      doc("C:\\Users\\me\\b.md"),
    );
    expect(linkTarget("C:/notes/a.md", null)).toEqual(doc("C:\\notes\\a.md"));
    expect(linkTarget("./a.md", "\\\\server\\share\\docs\\index.md")).toEqual(
      doc("\\\\server\\share\\docs\\a.md"),
    );
  });

  it("decodes a percent-encoded path, Chinese and spaces alike", () => {
    expect(
      linkTarget("./%E7%AB%A0%E7%AF%80%20%E4%B8%80.md", "/home/me/index.md"),
    ).toEqual(doc("/home/me/章節 一.md"));
    expect(linkTarget("./章節.md", "/home/me/index.md")).toEqual(
      doc("/home/me/章節.md"),
    );
    // A malformed escape is a file really named that way.
    expect(linkTarget("./100%.md", "/home/me/index.md")).toEqual(
      doc("/home/me/100%.md"),
    );
  });

  it("keeps the heading anchor of a link into another Markdown file", () => {
    expect(linkTarget("./ch1.md#section-2", "/home/me/index.md")).toEqual({
      ...doc("/home/me/ch1.md"),
      anchor: "section-2",
    });
    expect(
      linkTarget("./ch1.md#%E7%AB%A0%E7%AF%80", "/home/me/index.md"),
    ).toEqual({ ...doc("/home/me/ch1.md"), anchor: "章節" });
    // An empty anchor is no anchor: the file opens at its top.
    expect(linkTarget("./ch1.md#", "/home/me/index.md")).toStrictEqual(
      doc("/home/me/ch1.md"),
    );
    // Any other file is shown, not opened: its anchor leads nowhere.
    expect(linkTarget("./a.pdf#page=2", "/home/me/index.md")).toEqual({
      kind: "file",
      path: "/home/me/a.pdf",
    });
  });

  it("takes an absolute path as it is", () => {
    expect(linkTarget("/srv/notes/a.md", null)).toEqual(doc("/srv/notes/a.md"));
  });

  it("shows any other local file rather than opening it", () => {
    expect(linkTarget("./setup.exe", "/home/me/index.md")).toEqual({
      kind: "file",
      path: "/home/me/setup.exe",
    });
  });

  it("follows nothing relative from an unsaved document", () => {
    expect(linkTarget("./notes/ch1.md", null)).toBeNull();
    expect(linkTarget("picture.png", null)).toBeNull();
  });

  it("follows a heading of this document by its anchor", () => {
    expect(linkTarget("#intro", "/home/me/index.md")).toEqual({
      kind: "heading",
      anchor: "intro",
    });
    expect(linkTarget("#%E7%AB%A0%E7%AF%80", null)).toEqual({
      kind: "heading",
      anchor: "章節",
    });
    expect(linkTarget("#", null)).toBeNull();
  });

  it("opens web and mail links in the system", () => {
    for (const url of [
      "https://example.com/a?b#c",
      "http://example.com",
      "HTTPS://EXAMPLE.COM",
      "mailto:me@example.com",
    ])
      expect(linkTarget(url, "/home/me/index.md")).toEqual({
        kind: "web",
        url,
      });
  });

  it("refuses every other scheme", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "file:///etc/passwd",
      "file:///C:/Windows/System32/calc.exe",
      "data:text/html,<script>alert(1)</script>",
      "ms-settings:privacy",
      "vscode://file/x",
      "tauri://localhost/",
    ])
      expect(linkTarget(url, "/home/me/index.md"), url).toBeNull();
  });
});

describe("headingSlug", () => {
  it("writes a heading's anchor the way GitHub does", () => {
    expect(headingSlug("Getting Started!")).toBe("getting-started");
    expect(headingSlug("What's new in 1.0.4?")).toBe("whats-new-in-104");
    expect(headingSlug("第一章：開始")).toBe("第一章開始");
    expect(headingSlug("getting-started")).toBe("getting-started");
  });
});
