// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreateTab } from "./CreateTab";
import en from "../../i18n/locales/en";

const send = vi.fn();
vi.mock("../../ai/chat/useAgentConversation", () => ({
  useAgentConversation: () => ({ history: [], busy: false, send }),
}));
vi.mock("../../ai/chat/ChatBody", () => ({ ChatBody: () => null }));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: { aiProvider: "x", agentModels: {}, textusAi: true },
  }),
}));
vi.mock("../../platform/ipc", () => ({
  ai: {
    loadAgentWorkspace: () =>
      Promise.resolve({
        skills: [{ name: "theme", description: "", prompt: "Make a theme." }],
      }),
  },
}));

afterEach(cleanup);

it("starts a Create conversation with the chosen kind's skill loaded", async () => {
  render(<CreateTab t={en} />);
  // The built-in skills come in.
  await act(async () => {});
  fireEvent.click(screen.getByRole("radio", { name: en.extensionsTabThemes }));
  fireEvent.click(screen.getByText(en.createExampleThemeAmber));
  fireEvent.click(screen.getByText(en.createStart));
  const [, message, , options] = send.mock.calls[0];
  expect(message).toContain("Make a theme.");
  expect(message).toContain(en.createExampleThemeAmber);
  expect(options).toEqual({ mode: "create", webSearch: false });
});
