import { describe, expect, it } from "vitest";
import { NavHistory } from "./nav-history";

const alive = () => true;

describe("Back and Forward", () => {
  it("returns along the places jumps left, and forward again", () => {
    const history = new NavHistory();
    history.leave({ tabId: "a", top: 0 });
    history.leave({ tabId: "a", top: 900 });
    const here = { tabId: "b", top: 0 };
    expect(history.step(-1, here, alive)).toEqual({ tabId: "a", top: 900 });
    expect(history.step(-1, { tabId: "a", top: 900 }, alive)).toEqual({
      tabId: "a",
      top: 0,
    });
    expect(history.step(-1, { tabId: "a", top: 0 }, alive)).toBeNull();
    expect(history.step(1, { tabId: "a", top: 0 }, alive)).toEqual({
      tabId: "a",
      top: 900,
    });
    expect(history.step(1, { tabId: "a", top: 900 }, alive)).toEqual(here);
  });

  it("skips closed tabs, keeps nearby places as one, and a new jump drops Forward", () => {
    const history = new NavHistory();
    history.leave({ tabId: "gone", top: 0 });
    history.leave({ tabId: "a", top: 100 });
    history.leave({ tabId: "a", top: 120 });
    const open = (id: string) => id !== "gone";
    expect(history.step(-1, { tabId: "b", top: 0 }, open)).toEqual({
      tabId: "a",
      top: 100,
    });
    history.leave({ tabId: "a", top: 100 });
    expect(history.step(1, { tabId: "c", top: 0 }, open)).toBeNull();
    history.step(-1, { tabId: "c", top: 0 }, open);
    expect(history.step(-1, { tabId: "a", top: 100 }, open)).toBeNull();
  });
});
