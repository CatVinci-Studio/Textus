// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showProposalPictures } from "./pending-doc-pictures";

// A file is shown through Tauri's asset protocol.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<object>()),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

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
});
