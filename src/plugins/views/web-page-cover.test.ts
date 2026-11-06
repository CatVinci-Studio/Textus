// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { onWebPagesCover, webPagesCovered } from "./web-page-cover";

const settle = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe("webPagesCovered", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("is covered by a dialog or menu, not by a floating view", async () => {
    stop = onWebPagesCover(() => {});
    const pet = document.createElement("div");
    pet.className = "floating-view";
    pet.setAttribute("role", "dialog");
    document.body.append(pet);
    await settle();
    expect(webPagesCovered()).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    await settle();
    expect(webPagesCovered()).toBe(true);
  });
});
