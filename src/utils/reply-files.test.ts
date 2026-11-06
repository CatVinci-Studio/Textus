import { describe, expect, it } from "vitest";
import { replyFiles } from "./reply-files";

describe("replyFiles", () => {
  it("reads each closed block's language, path and text", () => {
    const text = [
      "Here:",
      "```js host.js",
      "exports.x = 1;",
      "```",
      "",
      "```CSS",
      "#write {}",
      "```",
      "",
      "```",
      "plain",
      "```",
    ].join("\n");
    expect(replyFiles(text)).toEqual([
      { lang: "js", path: "host.js", text: "exports.x = 1;\n" },
      { lang: "css", path: null, text: "#write {}\n" },
      { lang: "", path: null, text: "plain\n" },
    ]);
  });

  it("names a path only after a language, with a dot or a slash", () => {
    const paths = replyFiles(
      [
        "```js",
        "a",
        "```",
        "```md README.md",
        "b",
        "```",
        "```sh scripts/build",
        "c",
        "```",
        "```js example code",
        "d",
        "```",
      ].join("\n"),
    ).map((f) => f.path);
    expect(paths).toEqual([null, "README.md", "scripts/build", null]);
  });

  it("reads tilde fences, whose info string may hold a backtick", () => {
    expect(replyFiles("~~~css a`b.css\nx\n~~~")).toEqual([
      { lang: "css", path: "a`b.css", text: "x\n" },
    ]);
    expect(replyFiles("```css a`b.css\nx\n```")).toEqual([]);
  });

  it("keeps a shorter fence inside a longer one as its text", () => {
    const text = "````md guide.md\n```js\nx\n```\n````";
    expect(replyFiles(text)).toEqual([
      { lang: "md", path: "guide.md", text: "```js\nx\n```\n" },
    ]);
  });

  it("closes a fence only with its own kind and length", () => {
    expect(replyFiles("```css\nx\n~~~")).toEqual([]);
    expect(replyFiles("~~~css\nx\n```")).toEqual([]);
    expect(replyFiles("````css\nx\n```")).toEqual([]);
    expect(replyFiles("~~~~css\nx\n~~~")).toEqual([]);
  });

  it("skips a block still streaming", () => {
    expect(replyFiles("```js host.js\nexports.x = 1;\n")).toEqual([]);
  });

  it("reads the same reply once for every asker", () => {
    const text = "```js a.js\nx\n```";
    expect(replyFiles(text)).toBe(replyFiles(text));
  });
});
