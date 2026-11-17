// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { menuHost } from "./menu-panel";

afterEach(() => document.body.replaceChildren());

const dialog = (modal: boolean) => {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  if (modal) el.setAttribute("aria-modal", "true");
  const button = document.createElement("button");
  el.append(button);
  document.body.append(el);
  return { el, button };
};

it("a menu goes where its opener is, not into a floating view open elsewhere", () => {
  const settings = dialog(true);
  const pet = dialog(false);
  // Opened from the page: on the page, not in the pet's view.
  settings.el.remove();
  expect(menuHost()).toBe(document.body);
  // Opened in Settings while the pet is up: in Settings.
  document.body.prepend(settings.el);
  settings.button.focus();
  expect(menuHost()).toBe(settings.el);
  // Nothing focused, a modal open: in the modal.
  settings.button.blur();
  expect(menuHost()).toBe(settings.el);
  // Opened in the pet's own view: there.
  pet.button.focus();
  expect(menuHost()).toBe(pet.el);
  // By its button, wherever the focus is (WebKit doesn't focus a pressed
  // button).
  expect(menuHost(settings.button)).toBe(settings.el);
});
