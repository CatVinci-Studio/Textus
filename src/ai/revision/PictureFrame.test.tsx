// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGeneratedPicture } from "./PictureFrame";
import {
  discardGeneratedImage,
  loadGeneratedImage,
  rememberSaved,
} from "./generated-images";

const backend = vi.hoisted(() => ({
  generatedImage: vi.fn(),
  discardGeneratedImage: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../platform/ipc", () => ({ ai: backend }));

describe("useGeneratedPicture", () => {
  it("shows a picture accepted, undone and rejected, not its frame", async () => {
    backend.generatedImage.mockResolvedValueOnce({
      mime: "image/png",
      dataBase64: "iVBORw0KGgo=",
    });
    await loadGeneratedImage("card1");
    rememberSaved("card1", "images/card1.png");
    const { result, rerender } = renderHook(() => useGeneratedPicture("card1"));
    act(() => discardGeneratedImage("card1"));
    rerender();
    expect(result.current.url).toMatch(/^blob:/);
  });
});
