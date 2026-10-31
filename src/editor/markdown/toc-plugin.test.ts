// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { tocEntries } from "./toc-plugin";

afterEach(closeViews);

const tocLinks = (root: HTMLElement) =>
  [...root.querySelectorAll(".md-toc a")].map((a) => a.textContent);

describe("[TOC]", () => {
  it("opens as a table of contents and saves as written", async () => {
    const source = "[toc]\n\n# Intro\n\n## Setup\n\nText.";
    const t = await openView(source);
    expect(t.view.state.doc.firstChild?.type.name).toBe("toc");
    expect(tocLinks(t.view.dom)).toEqual(["Intro", "Setup"]);
    expect(t.markdown()).toBe(source);
  });

  it("indents each heading by its level below the shallowest", async () => {
    const t = await openView("[TOC]\n\n## A\n\n### B");
    const depths = [
      ...t.view.dom.querySelectorAll<HTMLElement>(".md-toc-item"),
    ].map((li) => li.style.getPropertyValue("--md-toc-depth"));
    expect(depths).toEqual(["0", "1"]);
  });

  it("stays text when the line says more than [TOC]", async () => {
    const t = await openView("[TOC] here\n\n# A");
    expect(t.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(t.markdown()).toBe("[TOC] here\n\n# A");
  });

  it("is made by Enter after typing [TOC] on a line of its own", async () => {
    const t = await openView("# A\n\n[TOC");
    t.type("]");
    expect(t.press("Enter")).toBe(true);
    expect(t.view.state.doc.child(1).type.name).toBe("toc");
    expect(t.caretLine()).toBe("|");
    expect(t.markdown()).toBe("# A\n\n[TOC]");
  });

  it("follows a heading's edit once typing rests", async () => {
    const t = await openView("[TOC]\n\n# Old");
    t.caretAtEnd();
    t.type("er");
    // The heading's id follows its text after a rest of its own, and the
    // TOC after that.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(tocLinks(t.view.dom)).toEqual(["Older"]);
    expect(t.view.dom.querySelector(".md-toc a")?.getAttribute("href")).toBe(
      "#older",
    );
  });
});

describe("tocEntries", () => {
  it("lists headings in order, skipping empty ones", async () => {
    const t = await openView("# A\n\n#\n\n> ## Quoted\n\n### C");
    expect(tocEntries(t.view.state.doc).map((e) => [e.level, e.text])).toEqual([
      [1, "A"],
      [2, "Quoted"],
      [3, "C"],
    ]);
  });
});
