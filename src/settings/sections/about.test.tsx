// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { links } from "../../platform/ipc";
import { AboutSection } from "./about";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.0.4"),
}));
vi.mock("../../platform/ipc", () => ({ links: { openAboutLink: vi.fn() } }));
vi.mock("./general", () => ({
  UpdateButton: () => null,
  UpdateChannelRow: () => null,
}));

const t = resolveStrings("en");
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("About", () => {
  it("shows the app's version", async () => {
    render(<AboutSection t={t} language="en" />);
    expect(await screen.findByText("Version 1.0.4")).toBeInTheDocument();
  });

  it("opens each of its pages by name", () => {
    render(<AboutSection t={t} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "Discord" }));
    fireEvent.click(screen.getByRole("button", { name: t.aboutQq }));
    expect(vi.mocked(links.openAboutLink).mock.calls).toEqual([
      ["github"],
      ["discord"],
      ["qq"],
    ]);
  });
});
