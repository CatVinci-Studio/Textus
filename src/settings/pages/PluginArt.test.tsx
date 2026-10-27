// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PluginIcon } from "./PluginArt";
import type { PluginManifest } from "../../plugins/store/manifest";

describe("a plugin without an icon", () => {
  it("shows its id's first letter, never a character of a translated name", () => {
    const manifest = {
      name: "函数图像",
      l10n: {},
    } as unknown as PluginManifest;
    const { container } = render(
      <PluginIcon id="catvinci.function-plot" manifest={manifest} />,
    );
    expect(container.textContent).toBe("F");
  });
});
