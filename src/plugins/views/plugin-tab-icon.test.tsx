// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../store/files", () => ({
  readPluginFile: async (_id: string, _origin: string, rel: string) => {
    if (rel === "gone.svg") throw new Error("missing");
    return new TextEncoder().encode("<svg/>");
  },
  dataUrl: (path: string) => `data:image/svg+xml;base64,${path}`,
}));
const { PluginTabIcon } = await import("./plugin-tab-icon");

describe("a plugin's sidebar tab icon", () => {
  it("is the plugins' own icon when it gives none, or its can't be read", async () => {
    const none = render(<PluginTabIcon plugin="p" origin="dev" />);
    expect(none.container.querySelector("svg")).not.toBeNull();
    const gone = render(
      <PluginTabIcon plugin="p" origin="dev" icon="gone.svg" />,
    );
    await waitFor(() =>
      expect(gone.container.querySelector("svg")).not.toBeNull(),
    );
  });

  it("is its own picture, drawn as a mask, when there is one", async () => {
    const own = render(<PluginTabIcon plugin="p" origin="dev" icon="i.svg" />);
    await waitFor(() =>
      expect(
        own.container.querySelector<HTMLElement>(".plugin-tab-icon")?.style
          .maskImage,
      ).toContain("i.svg"),
    );
  });
});
