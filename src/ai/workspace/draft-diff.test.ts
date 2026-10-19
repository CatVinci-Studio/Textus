// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  markDraftChanges,
  withChangeActions,
  withImagePlaceholders,
} from "./draft-diff";

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
    ).toEqual(["H1", "a", "P", "H4", "b", "P"]);
    // The prompt is text, never markup.
    expect(html).toContain("石雕 &lt;氛围&gt;");
  });

  it("shows a finished picture waiting for its text in place of the card", () => {
    const html = withImagePlaceholders(
      "<p>正文。</p>",
      [{ id: "a", anchor: "正文。", prompt: "p", preview: "asset://x.png" }],
      "正在生成配图",
      "配图已生成",
    );
    expect(html).toContain('<img src="asset://x.png"');
    expect(html).toContain("data-draft-picture");
    expect(html).toContain("配图已生成");
    expect(html).not.toContain("正在生成配图");
    // Its own accept / reject only when asked for.
    expect(html).not.toContain("data-image-action");
    const withActions = withImagePlaceholders(
      "<p>正文。</p>",
      [{ id: "a", anchor: "正文。", prompt: "p", preview: "asset://x.png" }],
      "正在生成配图",
      "配图已生成",
      {
        accept: "采纳",
        reject: "跳过",
        skipped: "已跳过这张配图",
        approved: "已采纳",
      },
    );
    expect(withActions).toContain('data-image-action="accept"');
    expect(withActions).toContain('data-image-action="reject"');
    // Skipped, it folds to one line that can still take it.
    const folded = withImagePlaceholders(
      "<p>正文。</p>",
      [
        {
          id: "a",
          anchor: "正文。",
          prompt: "p",
          preview: "asset://x.png",
          skipped: true,
        },
      ],
      "正在生成配图",
      "配图已生成",
      {
        accept: "采纳",
        reject: "跳过",
        skipped: "已跳过这张配图",
        approved: "已采纳",
      },
    );
    expect(folded).toContain("draft-image-skipped");
    expect(folded).toContain("已跳过这张配图");
    expect(folded).toContain('data-image-action="accept"');
    expect(folded).not.toContain("<img");
    // Accepted on its own: marked, and only 跳过 is left to change it.
    const approved = withImagePlaceholders(
      "<p>正文。</p>",
      [
        {
          id: "a",
          anchor: "正文。",
          prompt: "p",
          preview: "asset://x.png",
          approved: true,
        },
      ],
      "正在生成配图",
      "配图已生成",
      {
        accept: "采纳",
        reject: "跳过",
        skipped: "已跳过这张配图",
        approved: "已采纳",
      },
    );
    expect(approved).toContain("已采纳");
    expect(approved).not.toContain('data-image-action="accept"');
    expect(approved).toContain('data-image-action="reject"');
  });

  it("leaves the document alone with nothing pending", () => {
    expect(withImagePlaceholders("<p>x</p>", [], "…")).toBe("<p>x</p>");
  });
});

describe("withChangeActions", () => {
  const labels = {
    accept: "采纳",
    reject: "不采纳",
    acceptPart: "采纳这一段",
    rejectPart: "不采纳这一段",
    restore: "恢复",
  };
  const shape = (out: string) => {
    const template = document.createElement("template");
    template.innerHTML = out;
    return [...template.content.children].map((el) =>
      el.classList.contains("draft-change-actions")
        ? `bar:${(el as HTMLElement).dataset.call}`
        : el.classList.contains("draft-part-rejected")
          ? `gone:${el.querySelector("p")?.textContent}`
          : `${el.querySelector(".draft-part-actions") ? "±" : ""}${el.firstChild?.textContent}`,
    );
  };

  it("decides a whole change after its last block, each paragraph on it", () => {
    const { html } = markDraftChanges(
      "<p>Kept.</p>",
      "<p>Kept.</p><h2>One</h2><p>First.</p><h2>Two</h2>",
    );
    const out = withChangeActions(
      html,
      [
        {
          callId: "a",
          parts: [
            { call: "a", part: 0, text: "One" },
            { call: "a", part: 1, text: "First." },
          ],
        },
        { callId: "b", parts: [{ call: "b", part: 0, text: "Two" }] },
        { callId: "missing", parts: [{ call: "m", part: 0, text: "Nowhere" }] },
      ],
      labels,
    );
    // Two paragraphs: each its own ✓ / ✕; one paragraph: just the change.
    expect(shape(out)).toEqual([
      "Kept.",
      "±One",
      "±First.",
      "bar:a",
      "Two",
      "bar:b",
    ]);
  });

  it("puts a paragraph's ✓ / ✕ on it, not on a picture or an empty block", () => {
    const { html } = markDraftChanges(
      "",
      '<p>First.</p><p><img src="a.png"></p><p>Second.</p>',
    );
    const template = document.createElement("template");
    template.innerHTML = html;
    // A picture's frame sits under the first paragraph, marked as new.
    const figure = document.createElement("figure");
    figure.className = "draft-image-ready draft-added";
    template.content.firstElementChild!.after(figure);
    const out = withChangeActions(
      template.innerHTML,
      [
        {
          callId: "a",
          parts: [
            { call: "a", part: 0, text: "First." },
            { call: "a", part: 1, text: "" },
            { call: "a", part: 2, text: "Second." },
          ],
        },
      ],
      labels,
    );
    const back = document.createElement("template");
    back.innerHTML = out;
    const withActions = [
      ...back.content.querySelectorAll(".draft-part-actions"),
    ].map((bar) => bar.parentElement!.textContent?.replace(/[✓✕]/g, ""));
    expect(withActions).toEqual(["First.", "Second."]);
    expect(back.content.querySelector("figure .draft-part-actions")).toBeNull();
  });

  it("decides a rewrite whole: no paragraph-by-paragraph buttons", () => {
    const { html } = markDraftChanges(
      "<p>Same.</p><p>Old ending.</p>",
      "<p>Same.</p><p>New ending.</p>",
    );
    const out = withChangeActions(
      html,
      [
        {
          callId: "r",
          splittable: false,
          parts: [
            { call: "r", part: 0, text: "Same." },
            { call: "r", part: 1, text: "New ending." },
          ],
        },
      ],
      labels,
    );
    expect(out).not.toContain("draft-part-actions");
    const rows = shape(out);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe("bar:r");
  });

  it("keeps a rejected paragraph in its place, struck through with 恢复", () => {
    const { html } = markDraftChanges("", "<h2>One</h2><p>Third.</p>");
    const out = withChangeActions(
      html,
      [
        {
          callId: "a",
          parts: [
            { call: "a::0", part: -1, text: "One" },
            { call: "a::2", part: -1, text: "Third." },
          ],
          rejected: [
            { call: "a::1", part: 1, html: "<p>Second.</p>", after: "One" },
          ],
        },
      ],
      labels,
    );
    // Even the only change has its own 采纳 / 不采纳 - for the last one
    // left, the same as 全部采纳.
    expect(shape(out)).toEqual(["±One", "gone:Second.", "±Third.", "bar:a"]);
    expect(out).toContain('data-restore="a::1"');
  });
});
