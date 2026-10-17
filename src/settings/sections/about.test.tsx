// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { links } from "../../platform/ipc";
import { AboutSection } from "./about";

const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: { aiProvider: "openai", enableDiary: false },
  connected: false,
}));
vi.mock("../SettingsContext", () => ({ useSettings: () => mock }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.0.4"),
}));
vi.mock("../../ai/provider-catalog", () => ({
  useProviderCatalog: () => [{ id: "openai" }],
}));
vi.mock("./providers", () => ({
  fetchConnected: () =>
    Promise.resolve({ oauth: mock.connected, apiKey: false }),
}));
vi.mock("../../platform/ipc", () => ({ links: { openAboutLink: vi.fn() } }));
vi.mock("./general", () => ({ UpdateButton: () => null }));
vi.mock("../../platform/capabilities", () => ({ isDesktopApp: true }));

const t = resolveStrings("en");
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

async function tapVersion(times: number) {
  const version = await screen.findByText("Version 1.0.4");
  for (let i = 0; i < times; i++) fireEvent.click(version);
}

describe("About", () => {
  it("opens the diary on five taps once AI is connected, and closes Settings", async () => {
    mock.connected = true;
    const onClose = vi.fn();
    render(<AboutSection t={t} onClose={onClose} />);
    await new Promise((r) => setTimeout(r, 0));
    await tapVersion(4);
    expect(mock.setSettings).not.toHaveBeenCalled();
    await tapVersion(1);
    expect(mock.setSettings).toHaveBeenCalledWith({ enableDiary: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("does nothing at all without AI", async () => {
    mock.connected = false;
    const onClose = vi.fn();
    render(<AboutSection t={t} onClose={onClose} />);
    await tapVersion(5);
    expect(mock.setSettings).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens each of its pages by name", () => {
    render(<AboutSection t={t} onClose={vi.fn()} />);
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
