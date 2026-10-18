// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../../i18n/strings";
import type {
  AgentWorkspaceInfo,
  LibraryEntry,
  Memory,
} from "../../../platform/ipc";
import { libraryEntryId, MemorySections } from "./MemoryView";

const t = resolveStrings("en");

const record = {
  created: "2026-10-18T09:30:00Z",
  updated: "2026-10-18T09:30:00Z",
  conversation: "c-1",
  title: "Tighten the opening",
  document: "/novel/one.md",
};

const memory = (over: Partial<Memory>): Memory => ({
  id: "project/memory/x",
  scope: "project",
  kind: "preference",
  text: "x",
  file: "/novel/.textus/memory/x.md",
  remembered: record,
  included: true,
  ...over,
});

const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
  name: "Lin",
  aliases: [],
  include: "detected",
  file: ".textus/library/Lin.md",
  body: "Teaches Chinese.",
  remembered: null,
  ...over,
});

const workspace = (over: Partial<AgentWorkspaceInfo>): AgentWorkspaceInfo => ({
  instructions: [],
  project_instructions: null,
  skills: [],
  root: "/novel",
  style: null,
  library: [],
  memories: { items: [], chars: 0, cap: 4000 },
  remember: true,
  levis_project: false,
  ...over,
});

function renderTab(info: AgentWorkspaceInfo, libraryUse = null as never) {
  const handlers = {
    onOpenStyle: vi.fn(),
    onLearnStyle: vi.fn(),
    onNewEntry: vi.fn(),
    onOpenEntry: vi.fn(),
    onOpenInstructions: vi.fn(),
    onOpenGlobalInstructions: vi.fn(),
    onOpenFile: vi.fn(),
    onDeleteMemory: vi.fn(),
    onMoveMemory: vi.fn(),
    onDeleteEntry: vi.fn(),
    onConvertLevis: vi.fn(),
  };
  render(
    <MemorySections
      info={info}
      t={t}
      lang="en"
      libraryUse={libraryUse}
      {...handlers}
    />,
  );
  return handlers;
}

const section = () =>
  screen.getByText(t.memoryRemembered).closest("section") as HTMLElement;

afterEach(cleanup);

describe("the Memory tab's AI remembered section", () => {
  it("lists personal memories, then the project's and the facts it wrote", () => {
    renderTab(
      workspace({
        memories: {
          items: [
            memory({
              id: "personal/memory/brief",
              scope: "personal",
              text: "Reply briefly.",
            }),
            memory({ text: "Spell it colour.", kind: "requirement" }),
          ],
          chars: 30,
          cap: 4000,
        },
        library: [
          entry({ name: "Wu", body: "A doctor.", remembered: record }),
          entry({}),
        ],
      }),
    );
    const text = section().textContent ?? "";
    expect(text.indexOf("Reply briefly.")).toBeLessThan(
      text.indexOf("Spell it colour."),
    );
    expect(text).toContain("Wu: A doctor.");
    // The user's own library entry is not something the AI remembered.
    expect(text).not.toContain("Teaches Chinese.");
    expect(text).toContain("Requirement · Oct 18, 2026");
    expect(text).toContain("from “Tighten the opening”");
  });

  it("edits, moves and deletes a memory", () => {
    const personal = memory({
      id: "personal/memory/brief",
      scope: "personal",
      text: "Reply briefly.",
      file: "/config/agent/memory/brief.md",
    });
    const on = renderTab(
      workspace({ memories: { items: [personal], chars: 14, cap: 4000 } }),
    );
    const tab = within(section());
    fireEvent.click(tab.getByRole("button", { name: t.memoryEdit }));
    expect(on.onOpenFile).toHaveBeenCalledWith("/config/agent/memory/brief.md");
    fireEvent.click(screen.getByRole("button", { name: t.memoryMakeProject }));
    expect(on.onMoveMemory).toHaveBeenCalledWith(personal, "project");
    fireEvent.click(tab.getByRole("button", { name: t.memoryDelete }));
    expect(on.onDeleteMemory).toHaveBeenCalledWith(personal);
  });

  it("offers no move to a project when there is none", () => {
    renderTab(
      workspace({
        root: null,
        memories: {
          items: [memory({ id: "personal/memory/a", scope: "personal" })],
          chars: 1,
          cap: 4000,
        },
      }),
    );
    expect(
      screen.queryByRole("button", { name: t.memoryMakeProject }),
    ).toBeNull();
  });

  it("says when memories are left out of requests, and which", () => {
    renderTab(
      workspace({
        memories: {
          items: [
            memory({ id: "project/memory/a", text: "Kept." }),
            memory({ id: "project/memory/b", text: "Old.", included: false }),
          ],
          chars: 3990,
          cap: 4000,
        },
      }),
    );
    expect(
      screen.getByText(
        t.memoryOverCap.replace("{n}", "1").replace("{cap}", "4,000"),
      ),
    ).toBeVisible();
    expect(section()).toHaveTextContent(t.memoryNotSent);
  });

  it("warns as the memories near the limit", () => {
    renderTab(
      workspace({
        memories: { items: [memory({})], chars: 3500, cap: 4000 },
      }),
    );
    expect(
      screen.getByText(
        t.memoryNearCap.replace("{used}", "3,500").replace("{cap}", "4,000"),
      ),
    ).toBeVisible();
  });

  it("says when remembering is off", () => {
    renderTab(workspace({ remember: false }));
    expect(screen.getByText(t.memoryRememberOff)).toBeVisible();
  });
});

describe("the Memory tab's library", () => {
  it("marks exactly the entries Rust says were sent, and names those left out", () => {
    const lin = entry({});
    const wu = entry({ name: "Wu", file: ".textus/library/Wu.md" });
    const harbour = entry({
      name: "Harbour",
      file: ".textus/library/Harbour.md",
    });
    renderTab(workspace({ library: [lin, wu, harbour] }), {
      included: [wu.file],
      leftOut: [harbour.file],
      lastRequest: true,
      cap: 8000,
    } as never);
    const used = screen.getAllByText(t.memoryUsedInConversation);
    expect(used).toHaveLength(1);
    expect(used[0].closest(".memory-entry")).toHaveTextContent("Wu");
    expect(
      screen.getByText(
        t.memoryLibraryLeftOut
          .replace("{names}", "Harbour")
          .replace("{cap}", "8,000"),
      ),
    ).toBeVisible();
  });

  it("deletes an entry", () => {
    const lin = entry({});
    const on = renderTab(workspace({ library: [lin] }));
    fireEvent.click(
      screen.getByRole("button", { name: `${t.memoryDelete} Lin` }),
    );
    expect(on.onDeleteEntry).toHaveBeenCalledWith(lin);
    expect(libraryEntryId(lin)).toBe("project/library/Lin");
  });

  it("keeps a quiet way to convert a Levis project", () => {
    const on = renderTab(workspace({ levis_project: true }));
    fireEvent.click(screen.getByRole("button", { name: t.memoryConvertLevis }));
    expect(on.onConvertLevis).toHaveBeenCalled();
  });
});
