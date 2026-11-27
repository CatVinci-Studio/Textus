// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { AboutSection } from "./about";

vi.mock("../../platform/app-info", () => ({
  appVersion: () => Promise.resolve("1.4.8"),
}));
vi.mock("./general", () => ({ UpdateButton: () => null }));

afterEach(() => {
  delete (navigator as { share?: unknown }).share;
});

it("passes Textus on: copies the words where there is no share sheet", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<AboutSection t={en} openLicenses={() => {}} />);
  expect(screen.getByText(en.aboutShareLead)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.aboutShare }));
  });
  expect(writeText).toHaveBeenCalledWith(en.aboutShareText);
  expect(screen.getByRole("button", { name: en.codeBlockCopied })).toBeTruthy();
});

it("opens the system's share sheet where there is one", async () => {
  const share = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { share });
  render(<AboutSection t={en} openLicenses={() => {}} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.aboutShare }));
  });
  expect(share).toHaveBeenCalledWith({ text: en.aboutShareText });
});
