// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showProposalPictures } from "./pending-doc-pictures";
import { probeMissing } from "../../editor/images/missing-image";

// A file is shown through Tauri's asset protocol.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<object>()),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

// Counted: the disk is asked once for a picture that isn't there.
vi.mock("../../editor/images/missing-image", async (original) => {
  const real =
    await original<typeof import("../../editor/images/missing-image")>();
  return { ...real, probeMissing: vi.fn(real.probeMissing) };
});

describe("a proposal's own pictures", () => {
  it("are looked for beside the document, and one not there is the missing card", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<img src="images/flow.png" alt="研究流程">';
    document.body.append(root);
    const img = root.querySelector("img")!;
    showProposalPictures(root, "/notes/note.md");
    // Not beside the app: the document's folder, as the editor shows it.
    expect(img.getAttribute("src")).toBe(
      "asset://localhost//notes/images/flow.png",
    );
    expect(img.dataset.docSrc).toBe("images/flow.png");
    img.dispatchEvent(new Event("error"));
    await expect
      .poll(() => root.querySelector(".missing-image-card")?.textContent ?? "")
      .toContain("flow.png");
    expect(root.querySelector("img")).toBeNull();
    root.remove();
  });

  it("keep their element from one typewriter frame to the next", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const frame = (html: string) => {
      root.innerHTML = html;
      showProposalPictures(root, "/notes/note.md");
    };
    vi.mocked(probeMissing).mockClear();
    frame('<p>A <img src="images/gone.png" alt="x"></p>');
    root.querySelector("img")!.dispatchEvent(new Event("error"));
    await expect
      .poll(() => root.querySelector(".missing-image-card"))
      .toBeTruthy();
    const card = root.querySelector(".missing-image-card");
    // The next frame: the same card at once, no broken box, no second probe.
    frame('<p>A <img src="images/gone.png" alt="x"> more</p>');
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".missing-image-card")).toBe(card);
    expect(probeMissing).toHaveBeenCalledTimes(1);
    // A widget made again for it (a sentence's, keyed by its text): the
    // card at once all the same.
    const again = document.createElement("div");
    again.innerHTML = '<img src="images/gone.png" alt="x">';
    showProposalPictures(again, "/notes/note.md");
    expect(again.querySelector("img")).toBeNull();
    expect(again.querySelector(".missing-image-card")).toBeTruthy();
    expect(probeMissing).toHaveBeenCalledTimes(1);
    // One that loads stays the element that loaded, not loaded again.
    frame('<p><img src="images/here.png"></p>');
    const img = root.querySelector("img");
    frame('<p><img src="images/here.png"> and more</p>');
    expect(root.querySelector("img")).toBe(img);
    root.remove();
  });
});
