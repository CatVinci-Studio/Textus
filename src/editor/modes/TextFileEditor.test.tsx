// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextFileEditor, textFileLanguage } from "./TextFileEditor";
import { sourceViewAt } from "./source-view-registry";
import { flushEditor } from "../tab-editor";

afterEach(cleanup);

const tex = "\\section{Intro} % see [doc](a%20b)\n\\textbf{x} **not bold**\n";

describe("TextFileEditor", () => {
  it("finds the language by the plugin's name, else by the file's", () => {
    expect(textFileLanguage("main.tex", null)?.name).toBe("LaTeX");
    expect(textFileLanguage("style.sty", "latex")?.name).toBe("LaTeX");
    expect(textFileLanguage("data.yaml", null)?.name).toBe("YAML");
    expect(textFileLanguage("notes.unknown", null)).toBeNull();
  });

  it("colours LaTeX as LaTeX and keeps the text exactly as typed", async () => {
    const { container } = render(
      <TextFileEditor
        tabId="tex"
        value={tex}
        onChange={vi.fn()}
        typewriter={false}
        fileName="main.tex"
        language={null}
      />,
    );
    // The comment is coloured once LaTeX is read; nothing Markdown's:
    // no escape shown decoded.
    await waitFor(() =>
      expect(
        container.querySelectorAll(".cm-line span").length,
      ).toBeGreaterThan(1),
    );
    expect(container.querySelector(".cm-decoded-escape")).toBeNull();
    const { view } = sourceViewAt(container)!;
    view.dispatch({ changes: { from: tex.length - 1, insert: "!" } });
    expect(flushEditor("tex")).toBe(`${tex.slice(0, -1)}!\n`);
  });
});
