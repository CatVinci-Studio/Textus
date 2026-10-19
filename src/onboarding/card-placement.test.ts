import { describe, expect, it } from "vitest";
import {
  choosePlace,
  placedBox,
  type Box,
  type CardPlace,
} from "./card-placement";

const AREA: Box = { left: 18, top: 48, right: 1042, bottom: 882 };
const CARD = { width: 380, height: 360 };
const CORNERS: CardPlace[] = [
  "top-right",
  "bottom-right",
  "top-left",
  "bottom-left",
];

describe("a lesson card's place", () => {
  it("sits in a corner of the area", () => {
    expect(placedBox("top-right", 380, 360, AREA)).toEqual({
      left: 662,
      top: 48,
      right: 1042,
      bottom: 408,
    });
    expect(placedBox("bottom-left", 380, 360, AREA)).toEqual({
      left: 18,
      top: 522,
      right: 398,
      bottom: 882,
    });
  });

  it("stays where it is while that is clear", () => {
    expect(choosePlace(CORNERS, "bottom-left", CARD, AREA, [])).toEqual({
      place: "bottom-left",
      fits: true,
    });
  });

  it("moves off a proposal at the end of the text to the first clear corner", () => {
    // The new text, bottom right, under where the card was.
    const proposal = { left: 214, top: 540, right: 846, bottom: 570 };
    expect(
      choosePlace(CORNERS, "bottom-right", CARD, AREA, [proposal]),
    ).toEqual({ place: "top-right", fits: true });
  });

  it("keeps clear of a margin note and the review bar together", () => {
    const note = { left: 860, top: 100, right: 1040, bottom: 200 };
    const bar = { left: 420, top: 840, right: 640, bottom: 880 };
    expect(choosePlace(CORNERS, "top-right", CARD, AREA, [note, bar])).toEqual({
      place: "bottom-right",
      fits: true,
    });
  });

  it("says when nothing is clear, and takes the corner hiding least", () => {
    const everywhere = [
      { left: 0, top: 0, right: 1100, bottom: 300 },
      { left: 0, top: 600, right: 1100, bottom: 610 },
    ];
    expect(choosePlace(CORNERS, "top-right", CARD, AREA, everywhere)).toEqual({
      place: "bottom-right",
      fits: false,
    });
  });

  it("goes to the top on a phone when the AI sheet takes the bottom", () => {
    const area = { left: 12, top: 56, right: 418, bottom: 920 };
    const sheet = { left: 0, top: 500, right: 430, bottom: 932 };
    expect(
      choosePlace(
        ["bottom", "top"],
        "bottom",
        { width: 406, height: 300 },
        area,
        [sheet],
      ),
    ).toEqual({ place: "top", fits: true });
  });
});
