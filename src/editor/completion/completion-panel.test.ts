// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import "../../plugins/contributions/editor-extensions";
import { setKeyCapture } from "../../plugins/contributions/editor-input";
import { addCompletionSource, type CompletionSource } from "./sources";

// The / panel driven as the keyboard drives it: every matching source in
// one panel, grouped; what is known shows at once, and a slow source comes
// in without moving the row the user chose.

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

const removers: (() => void)[] = [];
afterEach(async () => {
  removers.splice(0).forEach((remove) => remove());
  await closeViews();
});

function source(
  over: Partial<CompletionSource> & Pick<CompletionSource, "id" | "provide">,
): CompletionSource {
  const added: CompletionSource = {
    owner: over.id.split(".").slice(0, 2).join("."),
    where: "text",
    pattern: /@(\w*)$/,
    title: () => over.id,
    ...over,
  };
  removers.push(addCompletionSource(added));
  return added;
}

const panel = () =>
  document.querySelector<HTMLElement>(".completion-list:not([hidden])");
const rows = () =>
  [
    ...(panel()?.querySelectorAll(".completion-group, .completion-item") ?? []),
  ].map(
    (el) =>
      (el.classList.contains("completion-group") ? "# " : "") +
      (el.querySelector(".completion-label")?.textContent ?? el.textContent),
  );
const chosen = () =>
  panel()?.querySelector('[aria-selected="true"] .completion-label')
    ?.textContent;

const items = (...labels: string[]) =>
  labels.map((label) => ({ label, insert: label }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

it("opens in the keystroke that matches, with what is known, grouped longest match first", async () => {
  source({
    id: "a.dates.at",
    provide: () => ({ items: items("today", "tomorrow"), complete: true }),
  });
  source({
    id: "b.cite.at",
    pattern: /\[@(\w*)$/,
    provide: () => ({ items: items("smith2020"), complete: true }),
  });
  const t = await openView("");
  t.type("see [@");
  // No await: the rows are there in the same task as the key.
  expect(rows()).toEqual([
    "# b.cite.at",
    "smith2020",
    "# a.dates.at",
    "today",
    "tomorrow",
  ]);
  expect(chosen()).toBe("smith2020");
  t.type("to");
  expect(rows()).toEqual(
    ["today", "tomorrow"].filter((l) => l.startsWith("to")),
  );
});

it("filters a whole list itself while the match grows, asking only once", async () => {
  const provide = vi.fn(() => ({
    items: items("alpha", "beta", "alphabet"),
    complete: true as const,
  }));
  source({ id: "a.words.at", provide });
  const t = await openView("");
  t.type("@al");
  expect(rows()).toEqual(["alpha", "alphabet"]);
  t.type("phab");
  expect(rows()).toEqual(["alphabet"]);
  expect(provide).toHaveBeenCalledTimes(1);
});

it("asks a provider that filters itself again on each key, calling off the last ask", async () => {
  const signals: AbortSignal[] = [];
  source({
    id: "a.live.at",
    provide: ({ query }, signal) => {
      signals.push(signal);
      // The first answer at once, the next ones still coming.
      return signals.length === 1 ? items(`${query}1`) : new Promise(() => {});
    },
  });
  const t = await openView("");
  t.type("@");
  expect(rows()).toEqual(["1"]);
  t.type("a");
  t.type("b");
  expect(signals).toHaveLength(3);
  expect(signals[1].aborted).toBe(true);
  // Its last rows stay while it answers: nothing jumps.
  expect(rows()).toEqual(["1"]);
  expect(signals[2].aborted).toBe(false);
});

it("a late group goes under the chosen row instead of moving it", async () => {
  const slow = deferred<ReturnType<typeof items>>();
  source({
    id: "a.fast.at",
    provide: () => ({ items: items("one", "two"), complete: true }),
  });
  source({ id: "b.slow.at", owner: "a", provide: () => slow.promise });
  const t = await openView("");
  t.type("@");
  expect(rows()).toEqual(["one", "two"]);
  expect(t.press("ArrowDown")).toBe(true);
  expect(chosen()).toBe("two");
  slow.resolve(items("late"));
  await slow.promise;
  await Promise.resolve();
  expect(rows()).toEqual(["one", "two", "# b.slow.at", "late"]);
  expect(chosen()).toBe("two");
});

it("Enter writes the item over the match and the ]] already after the caret", async () => {
  source({
    id: "a.notes.link",
    pattern: /\[\[([^\]]*)$/,
    provide: () => ({
      items: [{ label: "Plan", insert: "[[Plan]]", replaceAfter: 2 }],
      complete: true,
    }),
  });
  const t = await openView("Read  now");
  t.caretAt(" now");
  // The brackets pair as typed: "[[Pl|]]".
  t.type("[[Pl");
  expect(t.caretLine()).toBe("Read [[Pl|]] now");
  expect(rows()).toEqual(["Plan"]);
  expect(t.press("Enter")).toBe(true);
  expect(t.caretLine()).toBe("Read [[Plan]]| now");
  expect(panel()).toBeNull();
  // A link, not text a save would escape to \[\[Plan]].
  expect(t.markdown()).toBe("Read [[Plan]] now");
});

it("leaves the core's fallback out where a plugin matches from the same place", async () => {
  source({
    id: "core.notes",
    owner: "core",
    fallback: true,
    pattern: /\[\[([^\]]*)$/,
    provide: () => ({ items: items("Core note"), complete: true }),
  });
  const t = await openView("");
  t.type("[[");
  expect(rows()).toEqual(["Core note"]);
  t.press("Escape");
  await closeViews();
  source({
    id: "a.links.notes",
    pattern: /\[\[([^\]]*)$/,
    provide: () => ({ items: items("Plugin note"), complete: true }),
  });
  const again = await openView("");
  again.type("[[");
  expect(rows()).toEqual(["Plugin note"]);
});

it("the panel has the arrows, Enter and Esc before a plugin holding the keyboard", async () => {
  source({
    id: "a.words.at",
    provide: () => ({ items: items("one", "two"), complete: true }),
  });
  const delivered: string[] = [];
  setKeyCapture("test.vim", { mode: "all", keys: [] }, (key) =>
    delivered.push(key),
  );
  try {
    const t = await openView("");
    // Typed text goes past the capture here: only the keys matter.
    t.type("@");
    t.press("ArrowDown");
    expect(chosen()).toBe("two");
    t.press("Escape");
    expect(panel()).toBeNull();
    expect(delivered).toEqual([]);
  } finally {
    setKeyCapture("test.vim", null, () => {});
  }
});

it("[[ typed over words wraps them and looks for them", async () => {
  const asked: string[] = [];
  source({
    id: "a.links.notes",
    pattern: /\[\[([^\]]*)$/,
    provide: ({ query, after }) => {
      asked.push(`${query}|${after.slice(0, 2)}`);
      return { items: items("Weekly plan"), complete: true };
    },
  });
  const t = await openView("the weekly plan here");
  t.caretAt("weekly plan", 0, "weekly plan".length);
  t.type("[[");
  expect(t.caretLine()).toBe("the [[weekly plan|]] here");
  expect(asked.at(-1)).toBe("weekly plan|]]");
  expect(rows()).toEqual(["Weekly plan"]);
});

it(":name lists emoji, and taking one writes its shortcode", async () => {
  const { addEmojiCompletion } = await import("../emoji/emoji-completion");
  const { emojiNames } = await import("../emoji/emoji-shortcode-plugin");
  addEmojiCompletion(() => "Emoji");
  await emojiNames.load();
  const t = await openView("");
  t.type("so :smil");
  expect(rows()[0]).toBe("smile");
  t.press("Enter");
  expect(t.markdown()).toBe("so :smile:");
});

it("a time's colon offers no emoji", async () => {
  const { addEmojiCompletion } = await import("../emoji/emoji-completion");
  const { emojiNames } = await import("../emoji/emoji-shortcode-plugin");
  addEmojiCompletion(() => "Emoji");
  await emojiNames.load();
  const t = await openView("");
  // ":10" would offer :100: if a time's colon counted.
  t.type("at 10:10");
  expect(rows()).toEqual([]);
  t.type(" :tada");
  expect(rows()[0]).toBe("tada");
});

it("nothing opens in a code block", async () => {
  source({
    id: "a.words.at",
    provide: () => ({ items: items("one"), complete: true }),
  });
  const t = await openView("```\ncode\n```\n");
  t.caretAt("code", 4);
  t.type(" @");
  expect(panel()).toBeNull();
});
