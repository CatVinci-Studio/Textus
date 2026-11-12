import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  chromeScale,
  isDocumentSheet,
  scaleLengths,
} from "./vite.chrome-scale";

describe("one size for the whole interface", () => {
  it("scales every length of 3px and up, leaving hairlines and pills", () => {
    expect(scaleLengths("4px 8px")).toBe(
      "calc(4px * var(--chrome-scale, 1)) calc(8px * var(--chrome-scale, 1))",
    );
    expect(scaleLengths("1px solid var(--ui-border)")).toBe(
      "1px solid var(--ui-border)",
    );
    expect(scaleLengths("999px")).toBe("999px");
    expect(scaleLengths("translateX(-12px)")).toBe(
      "translateX(calc(-12px * var(--chrome-scale, 1)))",
    );
    expect(scaleLengths("calc(100% - 8px)")).toBe(
      "calc(100% - calc(8px * var(--chrome-scale, 1)))",
    );
  });

  it("leaves a length already scaled, and the document's own sheets", () => {
    expect(scaleLengths("calc(28px * var(--chrome-scale))")).toBe(
      "calc(28px * var(--chrome-scale))",
    );
    expect(isDocumentSheet("/a/src/theme/content-base.css")).toBe(true);
    expect(isDocumentSheet("/a/src/engine/controls/ContextMenu.css")).toBe(
      false,
    );
  });

  it("touches declarations, never a media query", async () => {
    const css = "@media (max-width: 600px) { .a { padding: 8px; } }";
    const out = await postcss([chromeScale()]).process(css, {
      from: "/repo/src/ui/x.css",
    });
    expect(out.css).toBe(
      "@media (max-width: 600px) { .a { padding: calc(8px * var(--chrome-scale, 1)); } }",
    );
  });

  it("leaves the document's own sheet alone once an @import brings it in", async () => {
    const app = postcss.parse(".a { padding: 8px; }", {
      from: "/repo/src/app/App.css",
    });
    const column = postcss.parse(".editor-content { max-width: 680px; }", {
      from: "/repo/src/app/editor-column.css",
    });
    app.append(column.nodes);
    const out = await postcss([chromeScale()]).process(app, {
      from: "/repo/src/app/App.css",
    });
    expect(out.css).toContain("max-width: 680px");
    expect(out.css).toContain("calc(8px * var(--chrome-scale, 1))");
  });
});
