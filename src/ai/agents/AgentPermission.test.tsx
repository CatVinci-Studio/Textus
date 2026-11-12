// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentPermission, commandCount } from "./AgentPermission";

afterEach(cleanup);

const long = Array.from(
  { length: 12 },
  (_, i) => `echo ${i} && cat "file ${i}.md"`,
).join(" && ");

it("says how many commands a long shell line runs, its text cut to a few lines until opened", () => {
  expect(commandCount('ls -a .. && find "x" -type f | wc -l; echo done')).toBe(
    4,
  );
  render(
    <AgentPermission
      pending={{
        title: long,
        kind: "execute",
        options: [{ optionId: "y", name: "Yes", kind: "allow_once" }],
        choose: vi.fn(),
      }}
      label="The agent asks to go on"
    />,
  );
  expect(screen.getByText("Run 24 commands")).toBeInTheDocument();
  const code = document.querySelector(".agent-command-text")!;
  expect(code).toHaveAttribute("data-clamped");
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(code).not.toHaveAttribute("data-clamped");
});
