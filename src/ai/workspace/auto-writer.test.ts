import { describe, expect, it } from "vitest";
import { userMessageBody } from "../chat/user-message";
import {
  ensureIllustrated,
  looksLikePlanFile,
  pictureSrc,
  parsePlan,
  planMaterial,
  planningPrompt,
  sectionPrompt,
  type WritingPlan,
} from "./auto-writer";

const plan: WritingPlan = {
  title: "西游记概要",
  guide: "面向中学生，语言平实",
  sections: [
    { title: "缘起", brief: "石猴出世", length: 400, image: true },
    { title: "取经", brief: "师徒西行", length: 600, image: false },
  ],
};

describe("looksLikePlanFile", () => {
  it("picks planning documents by name and type", () => {
    expect(looksLikePlanFile("大纲.md")).toBe(true);
    expect(looksLikePlanFile("docs/写作要求.txt")).toBe(true);
    expect(looksLikePlanFile("notes\\Outline-v2.markdown")).toBe(true);
    expect(looksLikePlanFile("chapter1.md")).toBe(false);
    expect(looksLikePlanFile("outline.png")).toBe(false);
    expect(looksLikePlanFile("资料/写作要求.docx")).toBe(true);
  });
});

describe("planMaterial", () => {
  it("labels each file and gives each an even share of the budget", () => {
    const text = planMaterial(
      [
        { path: "a.md", text: "  12345  " },
        { path: "b.docx", text: "67890" },
        { path: "c.pdf", text: "xyz" },
      ],
      9,
    );
    expect(text).toContain('<file path="a.md">\n123\n[…]\n</file>');
    expect(text).toContain('<file path="b.docx">\n678\n[…]\n</file>');
    expect(text).toContain('<file path="c.pdf">\nxyz\n</file>');
  });
});

describe("project pictures", () => {
  it("are shown by a path the document can resolve", () => {
    expect(pictureSrc("/p/novel", "图/封面 (1).jpg", "/p/novel/稿.md")).toBe(
      "图/封面%20%281%29.jpg",
    );
    expect(pictureSrc("/p/novel", "a.png", null)).toBe("/p/novel/a.png");
    expect(pictureSrc("/p/novel/", "a.png", "/elsewhere/x.md")).toBe(
      "/p/novel/a.png",
    );
  });

  it("are offered to the planner and kept only when real, once each", () => {
    const prompt = planningPrompt("m", "", true, true, ["img/a.jpg"]);
    expect(prompt).toContain("- img/a.jpg");
    expect(prompt).toContain('"picture"');
    const parsed = parsePlan(
      JSON.stringify({
        sections: [
          { title: "一", picture: "img/a.jpg", image: true },
          { title: "二", picture: "img/a.jpg" },
          { title: "三", picture: "made-up.png" },
        ],
      }),
      ["img/a.jpg"],
    );
    expect(parsed?.sections.map((s) => [s.picture, s.image])).toEqual([
      ["img/a.jpg", false],
      [undefined, false],
      [undefined, false],
    ]);
  });

  it("a section with one is written around it, not generated", () => {
    const prompt = sectionPrompt(
      plan,
      0,
      { images: true, first: false, pictureSrc: "img/a%20b.jpg" },
      true,
    );
    expect(prompt).toContain("![简短的图片说明](img/a%20b.jpg)");
    expect(prompt).not.toContain("generate_image 为本节");
  });
});

describe("planningPrompt", () => {
  it("carries the material and the user's extra requirements", () => {
    const prompt = planningPrompt("<file>x</file>", " 写给孩子 ", true);
    expect(prompt).toContain("<file>x</file>");
    expect(prompt).toContain("写给孩子");
    expect(prompt).toContain('"sections"');
  });

  it("plans from the request alone when there is no folder material", () => {
    const prompt = planningPrompt("", "写一篇关于雨夜搬家的短篇小说", true);
    expect(prompt).not.toContain("项目文件夹");
    expect(prompt).toContain("用户的要求");
    expect(prompt).toContain("写一篇关于雨夜搬家的短篇小说");
  });
});

describe("illustrations", () => {
  it("asks the planner to mark sections when pictures are on", () => {
    expect(planningPrompt("m", "", true, true)).toContain('"image":true');
    expect(planningPrompt("m", "", true, false)).not.toContain('"image":true');
  });

  it("gives an unmarked plan pictures, about one in three", () => {
    const bare = {
      ...plan,
      sections: Array.from({ length: 5 }, (_, i) => ({
        title: `S${i}`,
        brief: "",
        length: 300,
        image: false,
      })),
    };
    expect(ensureIllustrated(bare).sections.map((s) => s.image)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
    // A plan the model marked is left as it is.
    expect(ensureIllustrated(plan)).toBe(plan);
  });
});

describe("parsePlan", () => {
  it("reads the JSON object out of a chatty reply", () => {
    const parsed = parsePlan(
      '好的：\n```json\n{"title":" 标题 ","guide":"g","sections":[{"title":"一","brief":"b","length":800.4,"image":true},{"title":"二"}]}\n```',
    );
    expect(parsed).toEqual({
      title: "标题",
      guide: "g",
      sections: [
        { title: "一", brief: "b", length: 800, image: true },
        { title: "二", brief: "", length: 600, image: false },
      ],
    });
  });

  it("drops untitled sections, clamps lengths and caps the count", () => {
    const sections = Array.from({ length: 40 }, (_, i) => ({
      title: i === 0 ? "  " : `S${i}`,
      length: 99_999,
    }));
    const parsed = parsePlan(JSON.stringify({ sections }));
    expect(parsed?.sections).toHaveLength(30);
    expect(parsed?.sections[0]).toMatchObject({ title: "S1", length: 5000 });
  });

  it("returns null without usable sections", () => {
    expect(parsePlan("no json here")).toBeNull();
    expect(parsePlan("{not json}")).toBeNull();
    expect(parsePlan('{"sections":[]}')).toBeNull();
  });
});

describe("sectionPrompt", () => {
  it("asks for one appended section with the outline and guide", () => {
    const prompt = sectionPrompt(plan, 1, { images: true, first: false }, true);
    expect(prompt).toContain("【自动写作 2/2】");
    expect(prompt).toContain("「取经」");
    expect(prompt).toContain("2. 取经  ← 本节");
    expect(prompt).toContain("面向中学生");
    expect(prompt).toContain("append");
    // Not a section the plan illustrates, and not the first one.
    expect(prompt).not.toContain("generate_image");
    expect(prompt).not.toContain("一级标题");
  });

  it("opens the document and illustrates when the plan says so", () => {
    const prompt = sectionPrompt(
      plan,
      0,
      { images: true, first: true, revision: "更生动" },
      true,
    );
    expect(prompt).toContain("一级标题「西游记概要」");
    expect(prompt).toContain("generate_image");
    expect(prompt).toContain("更生动");
  });

  it("shows one line in the transcript and folds the brief away", () => {
    const prompt = sectionPrompt(
      plan,
      1,
      { images: false, first: false, revision: "加一个例子" },
      true,
    );
    expect(userMessageBody(prompt)).toBe(
      "【自动写作 2/2】取经（按意见重写：加一个例子）",
    );
  });

  it("leaves images out when the run has them off", () => {
    expect(
      sectionPrompt(plan, 0, { images: false, first: true }, false),
    ).not.toContain("generate_image");
  });
});
