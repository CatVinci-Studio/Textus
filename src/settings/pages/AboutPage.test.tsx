// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { AboutPage } from "./AboutPage";
import type { SettingsPageProps } from "./types";

const openAboutLink = vi.hoisted(() => vi.fn());
vi.mock("../../platform/ipc", () => ({
  links: {
    openAboutLink,
    openSponsorPage: vi.fn(),
    openCommunityPage: vi.fn(),
  },
}));
vi.mock("../../platform/app-info", () => ({
  appVersion: () => Promise.resolve("1.0.0"),
}));
vi.mock("../sections/general", () => ({
  UpdateButton: () => null,
  UpdateChannelRow: () => null,
}));
vi.mock("../sections/guides", () => ({ GuidesSection: () => null }));

afterEach(cleanup);

it("has a Star on GitHub button, last, that opens the repository", () => {
  render(
    <AboutPage
      {...({
        t: en,
        settings: { language: "en" },
        openHelp: () => {},
        onClose: () => {},
      } as unknown as SettingsPageProps)}
    />,
  );
  const star = screen.getByRole("button", { name: en.aboutStar });
  expect(star.parentElement?.lastElementChild).toBe(star);
  fireEvent.click(star);
  expect(openAboutLink).toHaveBeenCalledWith("github");
});
