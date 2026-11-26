import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import zh from "../i18n/locales/zh";
import { copyQuestion } from "./tree-file-drop";

describe("the question before files are copied into the tree", () => {
  it("says how many go where, and lists their names", () => {
    expect(copyQuestion(["/d/a.png"], "/notes/images", en, "en")).toBe(
      "Copy 1 item to “images”?\n\na.png",
    );
    expect(
      copyQuestion(["/d/a.png", "/d/b", "/d/c.pdf"], "/notes/images", zh, "zh"),
    ).toBe("将 3 个项目复制到“images”？\n\na.png\nb\nc.pdf");
  });

  it("cuts a long list short", () => {
    const paths = Array.from({ length: 8 }, (_, i) => `/d/${i + 1}.md`);
    expect(copyQuestion(paths, "/notes", en, "en")).toBe(
      "Copy 8 items to “notes”?\n\n1.md\n2.md\n3.md\n4.md\n5.md\nand 3 more",
    );
  });
});
