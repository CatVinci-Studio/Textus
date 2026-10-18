// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../MarkdownText", () => ({
  MarkdownText: ({ text }: { text: string }) => <p>{text}</p>,
}));
import { AgentTurnView } from "./AgentTurnView";
afterEach(cleanup);
it("shows assistant text without speech controls or provider configuration", () => {
  const { container } = render(
    <AgentTurnView
      turn={{ kind: "Assistant", text: "An assistant reply." }}
      labels={{
        selectionChip: (n) => `${n}`,
        toolActivity: {},
        toolResult: "Result",
      }}
    />,
  );
  expect(container.textContent).toBe("An assistant reply.");
  expect(
    container.querySelector(".speech-player, button, input, details"),
  ).toBeNull();
});
