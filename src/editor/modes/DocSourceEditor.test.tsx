// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { resolveStrings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { DocSourceEditor } from "./DocSourceEditor";
import { sourceViewAt } from "./source-view-registry";
import { imageMarkdown } from "./useSourceImagePaste";

// jsdom has no layout: CodeMirror measures a line with the range's rects, and
// a focus schedules that measure for the next frame.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

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
  const { container } = render(
    <DocSourceEditor
      docPath="/notes/a.md"
      value="ab"
      typewriter={false}
      onChange={onChange}
    />,
  );
  const view = sourceViewAt(container)!.view;
  view.dispatch({ selection: { anchor: 1 } });
  paste(container.querySelector(".cm-content")!, [
    new File(["x"], "shot.png", { type: "image/png" }),
  ]);
  await waitFor(
    () => expect(onChange).toHaveBeenCalledWith("a![](<assets/shot 1.png>)b"),
    // The store arrives through a dynamic import, slow on a busy machine.
    { timeout: 5000 },
  );
  expect(fs.savePastedImage).toHaveBeenCalledWith(
    "/notes/a.md",
    expect.any(String),
    "png",
    DEFAULT_SETTINGS.imageFolder,
  );
});

it("leaves a paste without pictures to CodeMirror", () => {
  const onChange = vi.fn();
  const { container } = render(
    <DocSourceEditor
      docPath="/notes/a.md"
      value=""
      typewriter={false}
      onChange={onChange}
    />,
  );
  paste(container.querySelector(".cm-content")!, []);
  expect(fs.savePastedImage).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it("writes a src with a space or a bracket in angle brackets", () => {
  expect(imageMarkdown("assets/a.png")).toBe("![](assets/a.png)");
  expect(imageMarkdown("assets/a b.png")).toBe("![](<assets/a b.png>)");
  expect(imageMarkdown("assets/a(1).png")).toBe("![](<assets/a(1).png>)");
});
