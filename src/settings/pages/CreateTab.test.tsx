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
// The chat's box, as far as Create uses it: filled in through its handle,
// and its message made ready by Create before it goes.
vi.mock("../../ai/chat/ChatBody", async () => {
  const { useState } = await import("react");
  return {
    ChatBody: (props: {
      labels: { placeholder: string };
      composerRef: { current: unknown };
      prepareMessage?: (m: string) => string;
      conversation: { send: (...args: unknown[]) => void };
    }) => {
      const [value, setValue] = useState("");
      props.composerRef.current = { restore: setValue };
      return (
        <>
          <textarea
            aria-label={props.labels.placeholder}
            value={value}
            readOnly
          />
          <button
            onClick={() =>
              props.conversation.send(
                null,
                props.prepareMessage?.(value) ?? value,
                [],
                { mode: "create" },
              )
            }
          >
            Send
          </button>
        </>
      );
    },
  };
});
vi.mock("../../ai/chat/chat-labels", () => ({
  chatLabels: () => ({ placeholder: "Ask anything" }),
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      aiProvider: "x",
      agentModels: {},
      textusAi: true,
      creations: [],
      userThemes: [],
      themeId: "default",
    },
  }),
}));
vi.mock("../../platform/ipc", () => ({
  ai: {
    listSkills: () => Promise.resolve([]),
    loadAgentWorkspace: () =>
      Promise.resolve({
        skills: [{ name: "theme", description: "", prompt: "Make a theme." }],
      }),
  },
}));

afterEach(cleanup);

it("starts a Create conversation with the starting point's kind's skill loaded", async () => {
  render(<CreateTab t={en} onOpenTab={() => {}} />);
  // Each starting point says what it makes.
  const amber = await screen.findByText(en.createExampleThemeAmber);
  expect(amber.closest("button")?.textContent).toContain(
    en.extensionsTabThemes,
  );
  fireEvent.click(amber);
  // The built-in skills are in before the first message goes.
  await act(async () => {});
  fireEvent.click(await screen.findByText("Send"));
  expect(send).toHaveBeenCalledOnce();
  const [, message] = send.mock.calls[0];
  expect(message).toContain("Make a theme.");
  expect(message).toContain(en.createExampleThemeAmber);
});

it("fills in a request made before it opened, for the user to finish", async () => {
  const { requestCreate } = await import("../../ai/chat/create-request");
  requestCreate("Change the Todo plugin (local.todo): ", "plugin");
  render(<CreateTab t={en} onOpenTab={() => {}} />);
  await act(async () => {});
  expect(screen.getByLabelText(en.createPlaceholder)).toHaveProperty(
    "value",
    "Change the Todo plugin (local.todo): ",
  );
});
