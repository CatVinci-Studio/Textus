// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment } from "../types";

const pickAttachmentFile = vi.fn();
const listSkills = vi.fn();
const listProjectFiles = vi.fn();
let supportsVision = true;

// The composer derives vision support from the active provider itself (so no
// caller can forget to pass it), which is what this stands in for.
vi.mock("../provider-catalog", () => ({
  useActiveProvider: () => ({ supportsVision }),
}));

vi.mock("../../platform/ipc", async () => {
  const actual =
    await vi.importActual<typeof import("../../platform/ipc")>(
      "../../platform/ipc",
    );
  return {
    ...actual,
    ai: {
      loadAgentWorkspace: vi.fn().mockResolvedValue({ skills: [] }),
      listSkills: (...args: unknown[]) => listSkills(...args),
      listProjectFiles: (...args: unknown[]) => listProjectFiles(...args),
      pickAttachmentFile: () => pickAttachmentFile(),
    },
  };
});

const { ChatComposer } = await import("./ChatComposer");
const { IpcError } = await import("../../platform/ipc");
const { pickerLabels } = await import("./ComposerPicker");
const { resolveStrings } = await import("../../i18n/strings");
const { BUILTIN_SKILLS } = await import("../skills/builtin");

const labels = {
  dropSelection: "Remove selection",
  atCursor: "At the cursor",
  placeholder: "Ask anything",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  selectedChars: (n: number) => `${n} chars selected`,
  attachmentTruncated: "(shortened)",
  attachmentNoVision: "This provider can't read images.",
  modeAsk: "Ask",
  modeEdit: "Edit",
  modePlan: "Plan",
  modeCreate: "Create",
  modeLabel: "Mode",
  webSearch: "Web search",
};

it("offers Create only in a document workspace", () => {
  render(
    <ChatComposer
      docPath={null}
      workspaceRoot={null}
      selectedText={null}
      busy={false}
      labels={labels}
      defaultMode="create"
      defaultWebSearch={false}
      allowCreate
      onSend={() => {}}
      onStop={() => {}}
      onEscape={() => {}}
    />,
  );
  // The modes live in the "+" menu, the current one on a chip beside it.
  expect(screen.getByRole("button", { name: "Mode: Create" })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Add content and tools" }),
  );
  expect(screen.getByRole("menuitemradio", { name: /Create/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

/** Opens "+" and picks the entry whose name matches. */
function pick(
  role: "menuitem" | "menuitemradio" | "menuitemcheckbox",
  name: RegExp,
) {
  fireEvent.click(
    screen.getByRole("button", { name: "Add content and tools" }),
  );
  fireEvent.click(screen.getByRole(role, { name }));
}

type ComposerOptions = {
  selectedText?: string | null;
  onSend?: (
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
  ) => void;
};

function composer({ selectedText = null, onSend = () => {} }: ComposerOptions) {
  return (
    <ChatComposer
      docPath={null}
      workspaceRoot={null}
      selectedText={selectedText}
      busy={false}
      labels={labels}
      defaultMode="ask"
      defaultWebSearch={false}
      onSend={onSend}
      onStop={() => {}}
      onEscape={() => {}}
    />
  );
}

function renderComposer(options: ComposerOptions = {}) {
  const onSend = options.onSend ?? vi.fn();
  return { ...render(composer({ ...options, onSend })), onSend };
}

const imageAttachment: ChatAttachment = {
  kind: "image",
  name: "chart.png",
  mime: "image/png",
  dataBase64: "AAAA",
};

beforeEach(() => {
  pickAttachmentFile.mockReset();
  listSkills.mockReset().mockResolvedValue(null);
  listProjectFiles.mockReset().mockResolvedValue([]);
  supportsVision = true;
});

// No vitest globals config, so RTL's auto-cleanup never registers - without
// this every later query sees the previous test's DOM too.
afterEach(cleanup);

describe("ChatComposer selection chip", () => {
  it("brings the chip back for a NEW selection after one was dismissed", () => {
    // The detached Agent window is the cross-file surface: the user goes on
    // highlighting passages while it is open, and each new highlight is a
    // fresh request to talk about it. A dismissal that stuck for the rest of
    // the chat meant every later selection silently failed to ride along.
    const { rerender } = renderComposer({ selectedText: "first passage" });
    expect(screen.getByText(/13 chars selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Remove selection"));
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();

    rerender(composer({ selectedText: "a different passage" }));
    expect(screen.getByText(/19 chars selected/)).toBeInTheDocument();
  });

  it("keeps the chip dismissed while that same selection is current", () => {
    // The other half: dismissing must survive an unrelated re-render, or the
    // chip would pop back the moment anything else in the window changed.
    const { rerender } = renderComposer({ selectedText: "first passage" });
    fireEvent.click(screen.getByLabelText("Remove selection"));

    rerender(composer({ selectedText: "first passage" }));
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();
  });

  it("tells send whether the selection should ride along", () => {
    const { onSend } = renderComposer({ selectedText: "passage" });
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("tighten this", [], true, {
      mode: "ask",
      webSearch: false,
    });
  });

  it("sends the selected interaction mode and web-search choice", () => {
    const { onSend } = renderComposer();
    pick("menuitemradio", /Plan/);
    // The chip says which mode is on, by its name and the mode's.
    expect(screen.getByRole("button", { name: "Mode: Plan" })).toBeVisible();
    pick("menuitemcheckbox", /Web search/);
    // A switch that is on shows beside "+", and turns off from there.
    expect(
      screen.getByRole("button", { name: /Web search/, pressed: true }),
    ).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "research this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("research this", [], true, {
      mode: "plan",
      webSearch: true,
    });
  });
});

describe("ChatComposer skills", () => {
  it("takes a picked skill back whole with one Backspace", async () => {
    listSkills.mockResolvedValue([
      {
        name: "polish",
        description: "Polish",
        category: null,
        invocation: "both",
        source: "global",
        overridesBuiltin: false,
        enabled: true,
        aliases: {},
      },
    ]);
    renderComposer();
    const input = screen.getByPlaceholderText("Ask anything");
    fireEvent.change(input, { target: { value: "/polish " } });
    // The list loads when the menu opens; reopen it to resolve the name.
    fireEvent.change(input, { target: { value: "/polish" } });
    await screen.findByText("/polish");
    fireEvent.change(input, { target: { value: "/polish " } });
    (input as HTMLTextAreaElement).setSelectionRange(8, 8);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input).toHaveValue("");
  });

  it("leaves Backspace alone inside a name still being typed", () => {
    renderComposer();
    const input = screen.getByPlaceholderText("Ask anything");
    fireEvent.change(input, { target: { value: "/pol" } });
    (input as HTMLTextAreaElement).setSelectionRange(4, 4);
    const event = fireEvent.keyDown(input, { key: "Backspace" });
    // Not prevented: the browser deletes one character as usual.
    expect(event).toBe(true);
  });
});

describe("ChatComposer attachments", () => {
  it("shows why a file could not be attached instead of doing nothing", async () => {
    // The regression this pins: every failure used to be swallowed by a
    // `.catch(() => null)`, so picking a PDF - which could not work at all -
    // was indistinguishable from a dead "+" button.
    pickAttachmentFile.mockRejectedValue(
      new IpcError("pick_attachment_file", "This PDF has no text layer."),
    );
    renderComposer();

    pick("menuitem", /Files and images/);
    expect(
      await screen.findByText("This PDF has no text layer."),
    ).toBeInTheDocument();
  });

  it("refuses an image when the provider has no vision", async () => {
    supportsVision = false;
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    pick("menuitem", /Files and images/);
    expect(
      await screen.findByText("This provider can't read images."),
    ).toBeInTheDocument();
    expect(screen.queryByText("chart.png")).not.toBeInTheDocument();
  });

  it("stages an image when the provider can read one", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    pick("menuitem", /Files and images/);
    expect(await screen.findByText("chart.png")).toBeInTheDocument();
  });

  it("says so when an attachment was cut at the extraction cap", async () => {
    // Silence here would read as "the model has my whole file" when it has
    // only the first part of it.
    pickAttachmentFile.mockResolvedValue({
      kind: "text",
      name: "big.pdf",
      content: "...",
      truncated: true,
    } satisfies ChatAttachment);
    renderComposer();

    pick("menuitem", /Files and images/);
    expect(await screen.findByText("(shortened)")).toBeInTheDocument();
  });

  it("hands staged attachments to send and clears them", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    const { onSend } = renderComposer();

    pick("menuitem", /Files and images/);
    await screen.findByText("chart.png");
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "what is this?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith(
      "what is this?",
      [imageAttachment],
      true,
      { mode: "ask", webSearch: false },
    );
    await waitFor(() =>
      expect(screen.queryByText("chart.png")).not.toBeInTheDocument(),
    );
  });
});

// The `/` and `@` pickers: they open on the keys a Chinese IME types too,
// always say something, and a typed alias resolves to the skill's name.
describe("ChatComposer pickers", () => {
  const builtins = BUILTIN_SKILLS.map((skill) => ({
    name: skill.name,
    description: `Model-facing description of ${skill.name}`,
    category: skill.category,
    invocation: skill.invocation,
    source: "builtin",
    overridesBuiltin: false,
    enabled: true,
    aliases: {},
  }));

  function renderZh(
    props: { docPath?: string | null; onEscape?: () => void } = {},
  ) {
    const onSend = vi.fn();
    const onEscape = props.onEscape ?? vi.fn();
    render(
      <ChatComposer
        docPath={props.docPath ?? null}
        workspaceRoot={null}
        selectedText={null}
        busy={false}
        labels={{ ...labels, picker: pickerLabels(resolveStrings("zh"), "zh") }}
        defaultMode="ask"
        defaultWebSearch={false}
        onSend={onSend}
        onStop={() => {}}
        onEscape={onEscape}
      />,
    );
    const input = screen.getByPlaceholderText("Ask anything");
    const type = (value: string) =>
      fireEvent.change(input, { target: { value } });
    return { onSend, onEscape, input, type };
  }

  it.each(["/", "／", "、", "・"])(
    "%s lists the built-ins by group, with their labels",
    async (key) => {
      listSkills.mockResolvedValue(builtins);
      const { type } = renderZh();
      type(key);
      const list = await screen.findByRole("listbox");
      expect(list).toHaveTextContent("接着写");
      expect(list).toHaveTextContent("/continue-story");
      for (const group of ["写作", "修改", "检查", "文体"])
        expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(18);
    },
  );

  it("explains / when there is no skill at all", async () => {
    listSkills.mockResolvedValue([]);
    const { type } = renderZh();
    type("/");
    const empty = await screen.findByRole("status");
    expect(empty).toHaveTextContent("输入 / 调用技能");
    expect(empty).toHaveTextContent("导入自己的技能");
  });

  it("says when nothing matches, instead of closing", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type } = renderZh();
    type("/zzz");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "没有与“zzz”匹配的技能",
    );
  });

  it("finds a skill by its localized label and alias", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type } = renderZh();
    type("/校");
    const first = (await screen.findAllByRole("option"))[0];
    expect(first).toHaveTextContent("校对");
    type("/续写");
    await waitFor(() =>
      expect(screen.getAllByRole("option")[0]).toHaveTextContent(
        "/continue-story",
      ),
    );
  });

  it("sends an alias as the canonical skill, keeping what was typed", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type, onSend, input } = renderZh();
    type("/");
    await screen.findByRole("listbox");
    type("、续写 林晚走进书店");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(
      '<skill name="continue-story" typed="/续写"></skill>\n\n林晚走进书店',
      [],
      true,
      { mode: "ask", webSearch: false },
    );
  });

  it("Enter picks the highlighted skill; Escape closes the menu, not the chat", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type, input, onEscape } = renderZh();
    type("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/describe ");

    type("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it.each(["@", "＠"])(
    "%s in an unsaved document says how to get files to attach",
    async (key) => {
      const { type } = renderZh();
      type(`看看 ${key}`);
      const empty = await screen.findByRole("status");
      await waitFor(() =>
        expect(empty).toHaveTextContent("保存文档或选择项目文件夹"),
      );
      expect(empty).toHaveTextContent("输入 @ 引用项目文件夹中的文件");
    },
  );

  it("@ lists the project's files with their folders", async () => {
    listProjectFiles.mockResolvedValue(["notes/plan.md", "readme.md"]);
    const { type } = renderZh({ docPath: "/p/draft.md" });
    type("＠pl");
    const option = await screen.findByRole("option");
    expect(option).toHaveTextContent("@plan.md");
    expect(option).toHaveTextContent("notes/");
  });
});
