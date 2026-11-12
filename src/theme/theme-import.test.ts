import { describe, expect, it, vi } from "vitest";

const files: Record<string, string> = {
  "/t/main.css":
    '@import "a.css";\n@import "p.css" print;\nbody { color: red; }',
  "/t/a.css": '@import "b.css";\n.a { x: 1; }',
  "/t/b.css": ".b { x: 2; }",
  "/t/p.css": ".p { x: 3; }",
};
vi.mock("../platform/ipc", () => ({
  fs: { readTextFile: (path: string) => Promise.resolve(files[path] ?? "") },
  themes: {},
}));

const { importThemeCss } = await import("./theme-import");

describe("importThemeCss", () => {
  it("inlines every import in order, nested ones too, a media one in its media", async () => {
    const css = await importThemeCss("/t/main.css");
    expect(css.indexOf(".b")).toBeLessThan(css.indexOf(".a"));
    expect(css.indexOf(".a")).toBeLessThan(css.indexOf(".p"));
    expect(css).toContain("@media print {\n.p { x: 3; }\n}");
    expect(css).toContain("body { color: red; }");
    expect(css).not.toContain("@import");
  });
});
