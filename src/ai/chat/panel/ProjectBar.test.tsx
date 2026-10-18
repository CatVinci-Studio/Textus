// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../../i18n/strings";
import type { AgentWorkspaceInfo } from "../../../platform/ipc";

const t = resolveStrings("en");
let answer: (info: AgentWorkspaceInfo | null) => void = () => {};

vi.mock("../../../settings/SettingsContext", () => ({
  useSettings: () => ({
    t,
    settings: { agentWorkspaceRoot: "", aiProvider: "custom", agentModels: {} },
    setSettings: vi.fn(),
  }),
}));
vi.mock("../../provider-catalog", () => ({ useActiveProvider: () => null }));
vi.mock("../../../platform/ipc", async () => {
  const actual = await vi.importActual<typeof import("../../../platform/ipc")>(
    "../../../platform/ipc",
  );
  return {
    ...actual,
    ai: {
      loadAgentWorkspace: vi.fn(
        () =>
          new Promise<AgentWorkspaceInfo | null>((resolve) => {
            answer = resolve;
          }),
      ),
    },
  };
});

const { ProjectBar } = await import("./ProjectBar");

const workspace = (root: string | null): AgentWorkspaceInfo => ({
  instructions: [],
  project_instructions: null,
  skills: [],
  root,
  style: null,
  library: [],
  memories: { items: [], chars: 0, cap: 4000 },
  remember: true,
  levis_project: false,
});

afterEach(cleanup);

describe("ProjectBar", () => {
  it("says nothing about the folder until the workspace has loaded", async () => {
    render(<ProjectBar docPath="/notes/draft.md" />);
    // The panel just opened: no answer yet, so no "too broad" either.
    expect(screen.queryByText(t.projectTooBroad)).toBeNull();
    await act(async () => answer(workspace("/notes")));
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.queryByText(t.projectTooBroad)).toBeNull();
  });

  it("still says so when the folder really is too broad", async () => {
    render(<ProjectBar docPath="/Users/me/draft.md" />);
    await act(async () => answer(workspace(null)));
    expect(screen.getByText(t.projectTooBroad)).toBeInTheDocument();
  });
});
