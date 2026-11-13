// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentPermission, commandCount } from "./AgentPermission";

afterEach(cleanup);

const long = Array.from(
  { length: 12 },
  (_, i) => `echo ${i} && cat "file ${i}.md"`,
).join(" && ");

it("says how many commands a long shell line runs, and shows all of it before it runs", () => {
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
  expect(code).not.toHaveAttribute("data-clamped");
  expect(code.textContent).toBe(long);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});
