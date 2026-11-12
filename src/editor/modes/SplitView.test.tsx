// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { resolveStrings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { SplitView } from "./SplitView";

vi.mock("../../platform/ipc", () => ({
  fs: { folderConventions: vi.fn(), savePastedImage: vi.fn() },
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: DEFAULT_SETTINGS,
    t: resolveStrings("en"),
  }),
}));
afterEach(cleanup);

/** A vault's conventions with "Strict line breaks" set as given. */
const vault = (strict: boolean) => ({
  sources: [{ app: "obsidian", root: "/v" }],
  linkStyle: null,
  linkPath: null,
  linkRoot: null,
  updateLinks: null,
  attachments: null,
  softBreaks: { value: !strict, app: "obsidian", root: "/v" },
  templates: null,
  daily: null,
  weekly: null,
  monthly: null,
  templateFormats: null,
  newNotes: null,
  ignore: [],
  detected: null,
});

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
  return () => container.querySelector(".split-preview");
}

// The preview is the editor, which draws a single newline as a soft break.
const SOFT_BREAK = '[data-type="hardbreak"][data-is-inline="true"]';

it("breaks the line at a single newline in a vault without strict line breaks", async () => {
  vi.mocked(fs.folderConventions).mockResolvedValue(vault(false));
  const pane = preview("/v/a.md");
  await waitFor(() =>
    expect(pane()?.classList.contains("split-preview-breaks")).toBe(true),
  );
  // The editor loads on the first preview: slow on a busy machine.
  await waitFor(
    () => expect(pane()?.querySelector(SOFT_BREAK)).not.toBeNull(),
    {
      timeout: 10_000,
    },
  );
});

it("keeps one paragraph line where the vault asks for strict line breaks", async () => {
  vi.mocked(fs.folderConventions).mockResolvedValue(vault(true));
  const pane = preview("/v/b.md");
  await waitFor(() =>
    expect(fs.folderConventions).toHaveBeenCalledWith("/v/b.md"),
  );
  // The editor loads on the first preview: slow on a busy machine.
  await waitFor(
    () => expect(pane()?.querySelector(SOFT_BREAK)).not.toBeNull(),
    {
      timeout: 10_000,
    },
  );
  expect(pane()?.classList.contains("split-preview-breaks")).toBe(false);
  expect(pane()?.innerHTML).not.toContain("<br>");
});

it("follows the source as it is typed", async () => {
  vi.mocked(fs.folderConventions).mockResolvedValue(vault(true));
  const view = (content: string) => (
    <SplitView
      content={content}
      filePath="/v/c.md"
      typewriter={false}
      onChange={() => {}}
      readOnly={false}
    />
  );
  const { container, rerender } = render(view("first"));
  const pane = () => container.querySelector(".split-preview .ProseMirror");
  await waitFor(() => expect(pane()?.textContent).toBe("first"));
  rerender(view("first\n\nsecond $x^2$"));
  await waitFor(() => expect(pane()?.textContent).toContain("second"));
});
