// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { openDiagramViewer } from "./diagram-zoom";

vi.mock("../i18n/current", () => ({
  currentStrings: () =>
    new Proxy({}, { get: (_, key) => String(key) }) as Record<string, string>,
}));

afterEach(() => {
  document.body.innerHTML = "";
});

const shown = () =>
  document.querySelector<HTMLImageElement>(".diagram-viewer-drawing")!;
const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k }));

it("pages through a set of pictures with the arrow keys, waiting for one still loading", async () => {
  const img = document.createElement("img");
  img.src = "data:light";
  let dark!: (url: string) => void;
  const close = openDiagramViewer(img, document.body, {
    pictures: ["data:light", new Promise((done) => (dark = done))],
    at: 0,
  });
  key("ArrowRight");
  dark("data:dark");
  await vi.waitFor(() => expect(shown().src).toBe("data:dark"));
  key("ArrowRight");
  await vi.waitFor(() => expect(shown().src).toBe("data:light"));
  expect(document.querySelectorAll(".diagram-viewer-turn")).toHaveLength(2);
  close();
});

it("a single picture has no paging, and opens at its size while its copy loads", () => {
  const img = document.createElement("img");
  img.src = "data:only";
  // The picture in the document has loaded; the viewer's copy (a picture
  // on a server) hasn't yet.
  Object.defineProperty(img, "naturalWidth", { value: 800 });
  Object.defineProperty(img, "naturalHeight", { value: 600 });
  openDiagramViewer(img, document.body);
  expect(shown().style.width).toBe("800px");
  expect(shown().style.height).toBe("600px");
  key("ArrowRight");
  expect(shown().src).toBe("data:only");
  expect(document.querySelector(".diagram-viewer-turn")).toBeNull();
});
