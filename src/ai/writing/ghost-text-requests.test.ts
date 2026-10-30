// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import type { Settings } from "../../prefs/SettingsContext";

// When typing asks for a completion: after a pause at the end of prose,
// never in code, after punctuation or on an empty line.

const complete = vi.hoisted(() => vi.fn(async () => " and so on."));
vi.mock("../../platform/ipc", async (original) => {
  const ipc = await original<typeof import("../../platform/ipc")>();
  return { ...ipc, ai: { ...ipc.ai, complete } };
});

beforeEach(() => complete.mockClear());
afterEach(async () => {
  vi.useRealTimers();
  await closeViews();
});

const open = async (
  markdown: string,
  language: Settings["language"] = "en",
) => {
  const t = await openView(
    markdown,
    { language, textusAi: true, enableCompletion: true },
    { ai: true },
  );
  vi.useFakeTimers();
  return t;
};

/** What the completion requests sent as the text after the caret. */
const afters = () =>
  complete.mock.calls.map((call) => (call as unknown[])[2] as string);

it("typing in a code block asks for no completion", async () => {
  const t = await open("```js\nconst total = count\n```\n\n后面");
  t.caretAt("count", 5);
  t.type("er");
  await vi.advanceTimersByTimeAsync(1200);
  expect(complete).not.toHaveBeenCalled();
});

it("mid-document, at a paragraph's end, a completion leads into what follows", async () => {
  const t = await open("The tide went\n\nThe boats came back at dusk.");
  t.caretAt("The tide went", 13);
  t.type(" o");
  await vi.advanceTimersByTimeAsync(1200);
  expect(afters()).toEqual([
    expect.stringContaining("The boats came back at dusk."),
  ]);
});

it("a pause asks once it has lasted, and an empty new paragraph asks nothing", async () => {
  const t = await open("The tide went");
  t.type(" o");
  // Still a breath between words.
  await vi.advanceTimersByTimeAsync(400);
  expect(complete).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(800);
  expect(complete).toHaveBeenCalledTimes(1);
  t.press("Enter");
  await vi.advanceTimersByTimeAsync(1200);
  expect(complete).toHaveBeenCalledTimes(1);
});

it("right after a full stop or a comma nothing is asked for; after a word it is", async () => {
  const t = await open("The tide went out");
  for (const mark of [". ", ","]) {
    t.type(mark);
    await vi.advanceTimersByTimeAsync(1200);
    expect(complete).not.toHaveBeenCalled();
  }
  t.type(" and");
  await vi.advanceTimersByTimeAsync(1200);
  expect(complete).toHaveBeenCalledTimes(1);
});

it("no completion is asked for right after a diagram with no prose, and the app's language goes along", async () => {
  const t = await open("```mermaid\ngraph TD\n  A-->B\n```\n\nx", "zh");
  t.press("Backspace");
  await vi.advanceTimersByTimeAsync(1200);
  expect(complete).not.toHaveBeenCalled();
  t.type("图");
  await vi.advanceTimersByTimeAsync(1200);
  expect(complete).toHaveBeenCalledTimes(1);
  const [, before, , , , hints] = complete.mock.calls[0] as unknown[];
  expect(before).toContain("graph TD");
  expect(hints).toMatchObject({ prose: "图", uiLanguage: "zh" });
});
