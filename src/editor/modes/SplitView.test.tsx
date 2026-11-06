// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { resolveStrings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { SplitView } from "./SplitView";

vi.mock("../../platform/ipc", () => ({
  fs: { obsidianVault: vi.fn(), savePastedImage: vi.fn() },
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: DEFAULT_SETTINGS,
    t: resolveStrings("en"),
  }),
}));
afterEach(cleanup);

const vault = {
  root: "/v",
  useMarkdownLinks: false,
  newLinkFormat: "shortest",
  attachmentFolder: "/",
  alwaysUpdateLinks: null,
};

function preview(filePath: string) {
  const { container } = render(
    <SplitView
      content={"one\ntwo"}
      filePath={filePath}
      typewriter={false}
      onChange={() => {}}
      readOnly={false}
    />,
  );
  return () => container.querySelector(".split-preview")?.innerHTML ?? "";
}

it("breaks the line at a single newline in a vault without strict line breaks", async () => {
  vi.mocked(fs.obsidianVault).mockResolvedValue({
    ...vault,
    strictLineBreaks: false,
  });
  const html = preview("/v/a.md");
  await waitFor(() => expect(html()).toContain("one<br>"));
});

it("keeps one paragraph line where the vault asks for strict line breaks", async () => {
  vi.mocked(fs.obsidianVault).mockResolvedValue({
    ...vault,
    strictLineBreaks: true,
  });
  const html = preview("/v/b.md");
  await waitFor(() => expect(fs.obsidianVault).toHaveBeenCalledWith("/v/b.md"));
  await new Promise((r) => setTimeout(r, 0));
  expect(html()).toContain("one\ntwo");
  expect(html()).not.toContain("<br>");
});
