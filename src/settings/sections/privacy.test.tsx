// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { PrivacySection } from "./privacy";

vi.mock("../../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasTextusAi: true,
  isDesktopApp: true,
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: { enableChatHistory: true },
    setSettings: () => {},
  }),
}));
vi.mock("../../platform/ipc", () => ({
  drafts: {},
  fs: {},
  storage: {},
  themes: {},
}));
vi.mock("../../ai/chat/chat-history", () => ({
  clearAllConversations: vi.fn(),
}));
vi.mock("./settings-file", () => ({
  SettingsFileSection: () => <div className="settings-row">Settings file</div>,
}));

afterEach(cleanup);

it("has two groups: Chat History (switch, clear) and Data (drafts, settings file), and no draft switches", () => {
  const { container } = render(<PrivacySection t={en} />);
  const groups = [...container.querySelectorAll(".settings-group")].map((g) => [
    g.getAttribute("aria-label"),
    [...g.querySelectorAll(".settings-row")].map((r) =>
      r.textContent?.replace(/Clear$/, "").trim(),
    ),
  ]);
  expect(groups).toEqual([
    [
      en.privacyChatHistoryLabel,
      [en.privacyChatHistoryToggle, en.privacyClearChatHistory],
    ],
    [en.privacyDataLabel, [en.privacyClearDrafts, "Settings file"]],
  ]);
  expect(container.textContent).not.toContain(en.privacyDraftRecoveryToggle);
});
