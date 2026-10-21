import { describe, expect, it } from "vitest";
import {
  generatedImageId,
  generatedImageSize,
  generatedImageSrc,
  hasGeneratedImage,
  parseImageProposal,
  showGeneratedImages,
  withSavedSrc,
} from "./generated-images";

const call = (args: object) => JSON.stringify(args);

describe("parseImageProposal", () => {
  it("proposes the picture as an image after its anchor", () => {
    const proposal = parseImageProposal(
      call({
        prompt: "A harbour at dusk",
        alt: "A [quiet]\nharbour",
        action: "insert_after",
        anchor: "The boats came in.",
        image: { id: "abc1", width: 1024, height: 768 },
      }),
    );
    expect(proposal).toEqual({
      action: "insert_after",
      anchor: "The boats came in.",
      context: undefined,
      text: `![A quiet harbour](${generatedImageSrc("abc1")})`,
      image: {
        id: "abc1",
        alt: "A quiet harbour",
        width: 1024,
        height: 768,
        pending: false,
      },
    });
  });

  it("marks a picture still being made, and keeps its size for its frame", () => {
    const proposal = parseImageProposal(
      call({
        prompt: "A harbour at dusk",
        alt: "Harbour",
        action: "append",
        image: { id: "abc2", width: 1536, height: 1024, pending: true },
      }),
    );
    expect(proposal?.image?.pending).toBe(true);
    expect(generatedImageSize("abc2")).toMatchObject({
      width: 1536,
      height: 1024,
    });
  });

  it("proposes nothing for a call that made no picture", () => {
    expect(
      parseImageProposal(
        call({ prompt: "x", action: "append", not_generated: "refused" }),
      ),
    ).toBeNull();
    // A place it can't go.
    expect(
      parseImageProposal(call({ action: "insert_after", image: { id: "a1" } })),
    ).toBeNull();
    expect(parseImageProposal("{")).toBeNull();
  });
});

describe("the placeholder src", () => {
  it("becomes the saved src, in <> when it holds a space", () => {
    const text = `![Boats](${generatedImageSrc("ab2")})`;
    expect(hasGeneratedImage(text)).toBe(true);
    expect(withSavedSrc(text, "ab2", "assets/boats.png")).toBe(
      "![Boats](assets/boats.png)",
    );
    expect(withSavedSrc(text, "ab2", "assets/my boats.png")).toBe(
      "![Boats](<assets/my boats.png>)",
    );
  });

  it("is a stand-in the preview keeps until the picture is loaded", () => {
    const text = `![Boats](${generatedImageSrc("ab3")})`;
    const shown = showGeneratedImages(text);
    // A data: src the renderer keeps, its id still readable for the frame.
    const src = /\]\((.+)\)$/.exec(shown)![1];
    expect(src).toMatch(/^data:image\/gif;/);
    expect(generatedImageId(src)).toBe("ab3");
    expect(generatedImageId(generatedImageSrc("ab3"))).toBe("ab3");
    expect(generatedImageId("assets/boats.png")).toBeNull();
    expect(showGeneratedImages("no picture")).toBe("no picture");
  });
});
