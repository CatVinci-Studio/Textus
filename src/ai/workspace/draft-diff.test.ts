// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markDraftChanges, withImagePlaceholders } from "./draft-diff";

describe("markDraftChanges", () => {
  it("marks a paragraph the draft adds", () => {
    const { html, changes } = markDraftChanges(
      "<h1>T</h1><p>One.</p><p>Three.</p>",
      "<h1>T</h1><p>One.</p><p>Two.</p><p>Three.</p>",
    );
    expect(changes).toBe(1);
    expect(html).toBe(
      '<h1>T</h1><p>One.</p><p class="draft-added">Two.</p><p>Three.</p>',
    );
  });

  it("points at the words an insert puts inside a paragraph", () => {
    const { html } = markDraftChanges(
      "<p>第三代面对的不是马枪，是公司。香蕉公司带来汽车。</p>",
      "<p>第三代面对的不是马枪，是公司。它背后是联合果实。香蕉公司带来汽车。</p>",
    );
    expect(html).toBe(
      '<p class="draft-changed">第三代面对的不是马枪，是公司。<ins class="draft-ins">它背后是联合果实。</ins>香蕉公司带来汽车。</p>',
    );
  });

  it("shows replaced words struck through beside the new ones, across markup", () => {
    const { html } = markDraftChanges(
      "<p>A <strong>bold</strong> old claim here.</p>",
      "<p>A <strong>bold</strong> new claim here.</p>",
    );
    expect(html).toBe(
      '<p class="draft-changed">A <strong>bold</strong> <del class="draft-del">old</del><ins class="draft-ins">new</ins> claim here.</p>',
    );
  });

  it("keeps a removed block, struck through, and counts each place once", () => {
    const { html, changes } = markDraftChanges(
      "<p>Keep.</p><p>Drop me.</p><p>Also keep.</p><p>End.</p>",
      "<p>Keep.</p><p>Also keep.</p><p>End.</p><p>New end.</p>",
    );
    expect(changes).toBe(2);
    expect(html).toContain(
      '<p class="draft-removed" aria-hidden="true">Drop me.</p>',
    );
    expect(html).toContain('<p class="draft-added">New end.</p>');
  });

  it("leaves an unchanged document alone", () => {
    const same = "<p>Nothing new.</p>";
    expect(markDraftChanges(same, same)).toEqual({ html: same, changes: 0 });
  });
});

describe("withImagePlaceholders", () => {
  it("puts a card after the block a pending picture follows", () => {
    const html = withImagePlaceholders(
      "<h1>玉米·黄金·美洲豹</h1><p>前言。</p><h4>单元三　美洲豹：站在人和神之间</h4><p>正文。</p>",
      [
        { id: "a", anchor: "# 玉米·黄金·美洲豹", prompt: "主视觉" },
        {
          id: "b",
          anchor: "#### 单元三　美洲豹：站在人和神之间",
          prompt: "石雕 <氛围>",
        },
        { id: "c", anchor: "不在文中", prompt: "其他" },
      ],
      "正在生成配图",
    );
    const template = document.createElement("template");
    template.innerHTML = html;
    expect(
      [...template.content.children].map(
        (el) => (el as HTMLElement).dataset.job ?? el.tagName,
      ),
    ).toEqual(["H1", "a", "P", "H4", "b", "P", "c"]);
    // The prompt is text, never markup.
    expect(html).toContain("石雕 &lt;氛围&gt;");
  });

  it("leaves the document alone with nothing pending", () => {
    expect(withImagePlaceholders("<p>x</p>", [], "…")).toBe("<p>x</p>");
  });
});
