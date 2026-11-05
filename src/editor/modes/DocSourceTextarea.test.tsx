// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { resolveStrings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { DocSourceTextarea } from "./DocSourceTextarea";
import { imageMarkdown } from "./useSourceImagePaste";

vi.mock("../../platform/ipc", () => ({
  fs: { savePastedImage: vi.fn() },
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, imageNamingMode: "auto" },
    t: resolveStrings("en"),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function paste(el: HTMLElement, files: File[]) {
  fireEvent.paste(el, {
    clipboardData: {
      items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
      files,
      getData: () => "",
    },
  });
}

it("stores a pasted picture and writes it at the caret", async () => {
  vi.mocked(fs.savePastedImage).mockResolvedValue({
    src: "assets/shot 1.png",
  } as never);
  const onChange = vi.fn();
  render(
    <DocSourceTextarea
      docPath="/notes/a.md"
      value="ab"
      typewriter={false}
      onChange={onChange}
      aria-label="source"
    />,
  );
  const el = screen.getByLabelText<HTMLTextAreaElement>("source");
  el.setSelectionRange(1, 1);
  paste(el, [new File(["x"], "shot.png", { type: "image/png" })]);
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith("a![](<assets/shot 1.png>)b"),
  );
  expect(fs.savePastedImage).toHaveBeenCalledWith(
    "/notes/a.md",
    expect.any(String),
    "png",
    DEFAULT_SETTINGS.imageFolder,
  );
});

it("leaves a paste without pictures to the textarea", () => {
  const onChange = vi.fn();
  render(
    <DocSourceTextarea
      docPath="/notes/a.md"
      value=""
      typewriter={false}
      onChange={onChange}
      aria-label="source"
    />,
  );
  paste(screen.getByLabelText("source"), []);
  expect(fs.savePastedImage).not.toHaveBeenCalled();
});

it("writes a src with a space or a bracket in angle brackets", () => {
  expect(imageMarkdown("assets/a.png")).toBe("![](assets/a.png)");
  expect(imageMarkdown("assets/a b.png")).toBe("![](<assets/a b.png>)");
  expect(imageMarkdown("assets/a(1).png")).toBe("![](<assets/a(1).png>)");
});
