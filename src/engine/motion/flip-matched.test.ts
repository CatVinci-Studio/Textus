// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const played: Map<Element, DOMRect>[] = [];
vi.mock("./motion", () => ({ motionAllowed: () => true }));
vi.mock("./flip", () => ({
  play: (before: Map<Element, DOMRect>) => played.push(before),
}));
const { flipMatched } = await import("./flip-matched");

const item = (text: string, top: number) => {
  const el = document.createElement("li");
  el.textContent = text;
  el.getBoundingClientRect = () => ({ top, left: 0 }) as DOMRect;
  return el;
};

it("slides each element built again from where the one with its key stood", () => {
  const list = document.createElement("ul");
  list.append(item("a", 0), item("b", 20), item("b", 40), item("c", 60));
  flipMatched(
    () => list.children,
    (el) => el.textContent ?? "",
    () =>
      list.replaceChildren(
        item("c", 0),
        item("b", 20),
        item("a", 40),
        item("b", 60),
        item("new", 80),
      ),
  );
  const before = played[0]!;
  const was = [...list.children].map((el) => before.get(el)?.top ?? null);
  // Like keys in order; one never there has nothing to slide from.
  expect(was).toEqual([60, 20, 0, 40, null]);
});
