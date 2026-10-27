// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { installTestLocalStorage } from "../../dev/test-local-storage";
import type { ChatAttachment } from "../types";

const pickAttachmentFile = vi.fn();
const listSkills = vi.fn();
const listProjectFiles = vi.fn();
let supportsVision = true;
let webSearchStatus: { native: boolean; service: string | null } | null = null;

// The composer derives vision support from the active provider itself.
vi.mock("../provider-catalog", () => ({
  useActiveProvider: () => ({ supportsVision }),
  useWebSearchStatus: () => webSearchStatus,
}));

// Whether the model can think deeper is mocked; the storage half stays real.
let canThinkDeeper = true;
vi.mock("./deep-thinking", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCanThinkDeeper: (enabled: boolean) => enabled && canThinkDeeper,
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
  showSelection: "Show in document",
  atCursor: "At the cursor",
  placeholder: "Ask anything",
  suggestionTab: "Tab",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  selectedChars: (n: number) => `${n} chars selected`,
  selectedPicture: "Picture selected",
  attachmentTruncated: "(shortened)",
  attachmentNoVision: "This provider can't read images.",
  modeWrite: "Write",
  modeReview: "Review",
  modeCreate: "Create",
  modeWriteHint: "Writes and changes the document",
  modeReviewHint: "Reads and leaves notes",
  modeCreateHint: "Makes themes, plugins and skills",
  modeLabel: "Mode",
  modelLabel: "Model",
  modeAndModelLabel: "Mode and model",
  webSearch: "Web search",
  deepThinking: "Deep thinking",
  deepThinkingHint:
    "Deep thinking: when it's on, Textus AI thinks longer before it answers",
  toggleOnHint: "{label} (On - click again to turn it off)",
  webSearchNeedsService: "Choose a search service",
};

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
      defaultMode="review"
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

beforeAll(installTestLocalStorage);
beforeEach(() => {
  pickAttachmentFile.mockReset();
  listSkills.mockReset().mockResolvedValue(null);
  listProjectFiles.mockReset().mockResolvedValue([]);
  supportsVision = true;
  canThinkDeeper = true;
  localStorage.clear();
  webSearchStatus = null;
});

describe("ChatComposer web search", () => {
  it("says when nothing can search instead of searching nothing", () => {
    webSearchStatus = { native: false, service: null };
    renderComposer();
    const button = screen.getByLabelText("Web search");
    // Off, there is nothing to warn about.
    expect(button).not.toHaveClass("needs-setup");
    fireEvent.click(button);
    expect(button).toHaveClass("needs-setup");
    expect(button).toHaveAccessibleDescription("Choose a search service");
  });

  it("shows no warning where the model or a service can search", () => {
    for (const status of [
      { native: true, service: null },
      { native: false, service: "tavily" },
    ]) {
      webSearchStatus = status;
      renderComposer();
      fireEvent.click(screen.getByLabelText("Web search"));
      expect(screen.getByLabelText("Web search")).not.toHaveClass(
        "needs-setup",
      );
      cleanup();
    }
  });
});

// No vitest globals config, so RTL's auto-cleanup never registers - without
// this every later query sees the previous test's DOM too.
afterEach(cleanup);

describe("ChatComposer selection chip", () => {
  it("brings the chip back for a NEW selection after one was dismissed", () => {
    // In the detached window each new highlight is a fresh request, so a
    // dismissal must not stick for later selections.
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

  it("tells the document while the chip shows, is pointed at, or is clicked", () => {
    const onChange = vi.fn();
    const onReveal = vi.fn();
    render(
      <ChatComposer
        docPath={null}
        workspaceRoot={null}
        selectedText="first passage"
        busy={false}
        labels={labels}
        defaultMode="review"
        defaultWebSearch={false}
        selectionChip={{ onChange, onReveal }}
        selectionPerMessage
        onSend={() => {}}
        onStop={() => {}}
        onEscape={() => {}}
      />,
    );
    expect(onChange).toHaveBeenLastCalledWith({ shown: true, hot: false });
    const chip = screen.getByTitle("Show in document");
    fireEvent.mouseEnter(chip.parentElement!);
    expect(onChange).toHaveBeenLastCalledWith({ shown: true, hot: true });
    fireEvent.click(chip);
    expect(onReveal).toHaveBeenCalledOnce();
    fireEvent.mouseLeave(chip.parentElement!);
    expect(onChange).toHaveBeenLastCalledWith({ shown: true, hot: false });

    // In the panel a selection rides with one message: sending uses it up,
    // and the chip and its highlight go with it.
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ shown: false, hot: false });
  });

  it("tells send whether the selection should ride along", () => {
    const { onSend } = renderComposer({ selectedText: "passage" });
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith(
      "tighten this",
      [],
      true,
      {
        mode: "review",
        webSearch: false,
        thinking: "auto",
      },
      "tighten this",
    );
  });

  it("reports its mode on the first render and on every switch", () => {
    const onModeChange = vi.fn();
    render(
      <ChatComposer
        docPath={null}
        workspaceRoot={null}
        selectedText={null}
        busy={false}
        labels={labels}
        defaultMode="review"
        defaultWebSearch={false}
        onSend={() => {}}
        onStop={() => {}}
        onEscape={() => {}}
        onModeChange={onModeChange}
      />,
    );
    const picker = screen.getByRole("combobox", { name: "Mode" });
    expect(onModeChange).toHaveBeenLastCalledWith("review");
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "Write" }));
    expect(onModeChange).toHaveBeenLastCalledWith("write");
    // The picker is words only: the icons are the empty panel's.
    expect(picker.querySelector("svg")).toBeNull();
  });

  it("sends the selected interaction mode and web-search choice", () => {
    const { onSend } = renderComposer();
    fireEvent.click(screen.getByRole("combobox", { name: "Mode" }));
    // Write, Review, then Create.
    expect(
      screen
        .getAllByRole("option")
        .map(
          (option) =>
            option.querySelector(".mode-picker-mode-name")?.textContent,
        ),
    ).toEqual(["Write", "Review", "Create"]);
    // Each with a line on what it does.
    expect(
      screen.getByRole("option", { name: "Review" }).textContent,
    ).toContain("Reads and leaves notes");
    fireEvent.click(screen.getByRole("option", { name: "Write" }));
    // Named for what it picks, not for one of its choices.
    expect(screen.queryByRole("combobox", { name: "Review" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Mode" }).textContent,
    ).toContain("Write");
    fireEvent.click(screen.getByLabelText("Web search"));
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "research this" },
    });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).toHaveBeenCalledWith(
      "research this",
      [],
      true,
      {
        mode: "write",
        webSearch: true,
        thinking: "auto",
      },
      "research this",
    );
  });
});

describe("ChatComposer Deep thinking", () => {
  function send(text: string) {
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByText("Send"));
  }

  it("asks for deep thinking while pressed, and stays pressed", () => {
    const { onSend, unmount } = renderComposer();
    const button = screen.getByRole("button", { name: "Deep thinking" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    send("think hard");
    expect(onSend).toHaveBeenLastCalledWith(
      "think hard",
      [],
      true,
      {
        mode: "review",
        webSearch: false,
        thinking: "deep",
      },
      "think hard",
    );
    // A new conversation, another document, the detached window: still on.
    unmount();
    const next = renderComposer();
    expect(
      screen.getByRole("button", { name: "Deep thinking" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Deep thinking" }));
    send("quick one");
    expect(next.onSend).toHaveBeenLastCalledWith(
      "quick one",
      [],
      true,
      {
        mode: "review",
        webSearch: false,
        thinking: "auto",
      },
      "quick one",
    );
  });

  it("has no button, and no Deep, for a model that can't think deeper", () => {
    localStorage.setItem("textus-agent-deep-thinking", "1");
    canThinkDeeper = false;
    const { onSend } = renderComposer();
    expect(screen.queryByRole("button", { name: "Deep thinking" })).toBeNull();
    send("hi");
    expect(onSend).toHaveBeenLastCalledWith(
      "hi",
      [],
      true,
      {
        mode: "review",
        webSearch: false,
        thinking: "auto",
      },
      "hi",
    );
  });

  it("asks Quick Ask's model for a fast answer, with no button", () => {
    localStorage.setItem("textus-agent-deep-thinking", "1");
    const onSend = vi.fn();
    render(
      <ChatComposer
        docPath={null}
        workspaceRoot={null}
        selectedText={null}
        busy={false}
        labels={labels}
        defaultMode="write"
        compact
        defaultWebSearch={false}
        onSend={onSend}
        onStop={() => {}}
        onEscape={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Deep thinking" })).toBeNull();
    send("shorten");
    expect(onSend).toHaveBeenLastCalledWith(
      "shorten",
      [],
      true,
      {
        mode: "write",
        webSearch: false,
        thinking: "fast",
      },
      "shorten",
    );
  });
});

describe("ChatComposer attachments", () => {
  it("shows why a file could not be attached instead of doing nothing", async () => {
    // Every failure must surface: a PDF that can't work must not look like a
    // dead "+" button.
    pickAttachmentFile.mockRejectedValue(
      new IpcError("pick_attachment_file", "This PDF has no text layer."),
    );
    renderComposer();

    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(
      await screen.findByText("This PDF has no text layer."),
    ).toBeInTheDocument();
  });

  it("refuses an image when the provider has no vision", async () => {
    supportsVision = false;
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(
      await screen.findByText("This provider can't read images."),
    ).toBeInTheDocument();
    expect(screen.queryByText("chart.png")).not.toBeInTheDocument();
  });

  it("stages an image when the provider can read one", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    fireEvent.click(screen.getByLabelText("Attach a file"));
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

    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(await screen.findByText("(shortened)")).toBeInTheDocument();
  });

  it("hands staged attachments to send and clears them", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    const { onSend } = renderComposer();

    fireEvent.click(screen.getByLabelText("Attach a file"));
    await screen.findByText("chart.png");
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "what is this?" },
    });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).toHaveBeenCalledWith(
      "what is this?",
      [imageAttachment],
      true,
      { mode: "review", webSearch: false, thinking: "auto" },
      "what is this?",
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
    modes: [skill.mode],
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
        defaultMode="write"
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
    "%s lists the mode's built-ins by group, with their labels",
    async (key) => {
      listSkills.mockResolvedValue(builtins);
      const { type } = renderZh();
      type(key);
      const list = await screen.findByRole("listbox");
      expect(list).toHaveTextContent("扩写");
      expect(list).toHaveTextContent("/expand");
      for (const group of ["修改", "文体"])
        expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
      // Write's four: Review's and Create's are in their own modes.
      expect(screen.getAllByRole("option")).toHaveLength(4);
      expect(list).not.toHaveTextContent("校对");
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
    type("/精");
    const first = (await screen.findAllByRole("option"))[0];
    expect(first).toHaveTextContent("精简");
    type("/翻译");
    await waitFor(() =>
      expect(screen.getAllByRole("option")[0]).toHaveTextContent("/translate"),
    );
  });

  it("sends an alias as the canonical skill, keeping what was typed", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type, onSend, input } = renderZh();
    type("/");
    await screen.findByRole("listbox");
    type("、翻译 林晚走进书店");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(
      '<skill name="translate" typed="/翻译"></skill>\n\n林晚走进书店',
      [],
      true,
      { mode: "write", webSearch: false, thinking: "auto" },
      "、翻译 林晚走进书店",
    );
  });

  it("Enter picks the highlighted skill; Escape closes the menu, not the chat", async () => {
    listSkills.mockResolvedValue(builtins);
    const { type, input, onEscape } = renderZh();
    type("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/tighten ");

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

describe("ChatComposer suggested next message", () => {
  it("shows it grey in the empty box and Tab takes it", () => {
    render(
      <ChatComposer
        docPath={null}
        workspaceRoot={null}
        selectedText={null}
        busy={false}
        labels={labels}
        defaultMode="review"
        defaultWebSearch={false}
        suggestion="Translate the next chapter too"
        onSend={() => {}}
        onStop={() => {}}
        onEscape={() => {}}
      />,
    );
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Translate the next chapter too  (Tab)");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box.value).toBe("Translate the next chapter too");
    // Typed over, the suggestion goes and Tab is Tab again.
    fireEvent.change(box, { target: { value: "No, " } });
    expect(box.placeholder).toBe("Ask anything");
  });

  it("offers nothing while a reply is coming", () => {
    render(
      <ChatComposer
        docPath={null}
        workspaceRoot={null}
        selectedText={null}
        busy={true}
        labels={labels}
        defaultMode="review"
        defaultWebSearch={false}
        suggestion="Translate the next chapter too"
        onSend={() => {}}
        onStop={() => {}}
        onEscape={() => {}}
      />,
    );
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Ask anything");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box.value).toBe("");
  });
});
