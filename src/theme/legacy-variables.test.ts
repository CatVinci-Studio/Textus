import { describe, expect, it } from "vitest";
import { withCurrentVariables } from "./legacy-variables";

describe("a pre-1.3 theme's variables", () => {
  it("are read under today's names", () => {
    expect(
      withCurrentVariables(
        "#write { color: var(--editor-text); background: var(--editor-code-bg); border-radius: var(--md-radius); }",
      ),
    ).toBe(
      "#write { color: var(--doc-text); background: var(--doc-code-bg); border-radius: var(--doc-radius); }",
    );
    expect(
      withCurrentVariables(
        ":root { --sidebar-active-text: #111; --sidebar-active: #eee; --bg: #fff; --border-color: #ddd; }",
      ),
    ).toBe(
      ":root { --ui-selected-text: #111; --ui-selected: #eee; --ui-bg: #fff; --ui-border: #ddd; }",
    );
  });

  it("leaves Typora's own variables and longer names alone", () => {
    const typora =
      ":root { --bg-color: #fff; --side-bar-bg-color: #fafafa; --text-color: #333; --danger-zone: red; }";
    expect(withCurrentVariables(typora)).toBe(typora);
  });
});
