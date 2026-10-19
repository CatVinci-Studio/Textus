import { useEffect, useState } from "react";
import { ai } from "../../platform/ipc";
import type { Settings } from "../../settings/SettingsContext";

/**
 * Small one-shot text tasks for the Agent home - starting suggestions and a
 * title for an untitled document. They run through the built-in agent loop
 * (no engine: no Node runtime to start) in Ask mode, on the configured text
 * model, and never edit the document.
 */
async function quickText(
  settings: Settings,
  document: string,
  message: string,
  requestId: string,
): Promise<string> {
  const turns = await ai.agentMessage({
    provider: settings.aiProvider,
    model: settings.agentModels[settings.aiProvider] || null,
    document,
    docPath: null,
    workspaceRoot: null,
    history: [],
    message,
    images: [],
    webSearch: false,
    mode: "ask",
    requestId,
    uiLanguage: settings.language,
  });
  return turns
    .map((turn) => (turn.kind === "Assistant" ? turn.text : ""))
    .join("\n")
    .trim();
}

export interface Suggestion {
  /** The chip's few words. */
  label: string;
  /** What fills the composer: a concrete, ready-to-send request. */
  prompt: string;
}

/** Shown at once, and whenever AI suggestions are off or unavailable. */
export function fallbackSuggestions(
  language: string,
  hasDocument: boolean,
): Suggestion[] {
  const zh = language.startsWith("zh");
  if (hasDocument)
    return zh
      ? [
          {
            label: "润色全文",
            prompt:
              "润色全文：保持原意和结构，修正语病与重复用词，让句子更简洁流畅；每处改动作为单独的修改提议，方便我逐条采纳。",
          },
          {
            label: "写一段摘要",
            prompt:
              "为这篇文档写一段 150 字左右的摘要，概括核心观点和结论，放在一级标题下方，语气与正文一致。",
          },
          {
            label: "续写下一节",
            prompt:
              "按照现有的写作风格和结构续写下一节，约 500 字，给出一个与前文衔接的二级标题，并在结尾自然引出下一部分。",
          },
          {
            label: "检查逻辑",
            prompt:
              "通读全文，找出论证不充分、前后矛盾或缺少例证的地方，逐条说明问题所在，并为每一处给出具体的修改建议。",
          },
        ]
      : [
          {
            label: "Polish the text",
            prompt:
              "Polish the whole document: keep its meaning and structure, fix grammar and repeated words, and make sentences tighter. Propose each change separately so I can accept them one by one.",
          },
          {
            label: "Write a summary",
            prompt:
              "Write a summary of about 120 words that captures the main points and conclusion, placed under the title, in the document's own tone.",
          },
          {
            label: "Continue",
            prompt:
              "Continue with the next section in the existing style and structure: about 400 words with a fitting heading that follows on from the previous part.",
          },
          {
            label: "Check the logic",
            prompt:
              "Read the whole document and point out weak arguments, contradictions or missing examples, with a concrete suggestion for each.",
          },
        ];
  return zh
    ? [
        {
          label: "名著概要",
          prompt:
            "写一篇《西游记》的内容概要：分为“取经缘起”“取经途中”“功德圆满”三部分，每部分约 200 字，再列出 5 个最具代表性的故事情节并各用一句话点评。",
        },
        {
          label: "文章大纲",
          prompt:
            "帮我写一篇《人工智能如何改变日常写作》的文章大纲：分 5 节，每节给出小标题和 2–3 个要点，开头附一段 100 字左右的引言。",
        },
        {
          label: "短篇故事",
          prompt:
            "写一篇 800 字左右的短篇故事：主角是在深夜书店打工的大学生，第三人称叙述，基调温暖，结尾留一点悬念。",
        },
        {
          label: "会议纪要",
          prompt:
            "起草一份项目周会纪要：包含会议信息、本周进展、风险与问题、下周计划，以及一张“待办事项 / 负责人 / 截止日期”表格。",
        },
      ]
    : [
        {
          label: "Book summary",
          prompt:
            "Write a summary of Journey to the West in three parts - the origins, the pilgrimage, and its completion - about 150 words each, then list five representative episodes with a one-line comment on each.",
        },
        {
          label: "Article outline",
          prompt:
            "Outline an article on how AI is changing everyday writing: five sections, each with a heading and 2–3 key points, plus a 80-word introduction.",
        },
        {
          label: "Short story",
          prompt:
            "Write a 700-word short story about a student working night shifts in a bookshop, told in the third person, warm in tone, ending on a small mystery.",
        },
        {
          label: "Meeting notes",
          prompt:
            "Draft weekly project meeting notes: meeting details, progress, risks and issues, next week's plan, and a table of action items with owner and due date.",
        },
      ];
}

function parseSuggestions(text: string): Suggestion[] | null {
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (!json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return null;
    const items = value
      .filter(
        (item): item is Suggestion =>
          !!item &&
          typeof item.label === "string" &&
          typeof item.prompt === "string" &&
          item.label.trim().length > 0 &&
          item.prompt.trim().length > 10,
      )
      .slice(0, 4)
      .map((item) => ({
        label: [...item.label.trim()].slice(0, 16).join(""),
        prompt: item.prompt.trim().slice(0, 400),
      }));
    return items.length >= 2 ? items : null;
  } catch {
    return null;
  }
}

const CACHE_PREFIX = "textus-agent-suggestions:";

/** A short, stable key for "this document, in this language". */
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++)
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * The Agent home's chips: the fallbacks at once, replaced by suggestions the
 * text model writes for this document. Cached per document state, so
 * reopening the home costs nothing; only while `active` (home visible,
 * nothing sent yet) and enabled in Settings.
 */
export function useAgentSuggestions(
  settings: Settings,
  document: string,
  active: boolean,
) {
  const excerpt = document.slice(0, 3000);
  const hasDocument = excerpt.trim().length > 0;
  const key =
    CACHE_PREFIX +
    fingerprint(`${settings.language}\n${settings.aiProvider}\n${excerpt}`);
  const [generated, setGenerated] = useState<{
    key: string;
    items: Suggestion[];
  } | null>(null);
  const enabled = settings.enableAiSuggestions && active;
  const { language } = settings;
  useEffect(() => {
    if (!enabled) return;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const items = parseSuggestions(cached);
      if (items) {
        setGenerated({ key, items });
        return;
      }
    }
    const requestId = crypto.randomUUID();
    let cancelled = false;
    // Typing in Write, then coming back: wait until the text settles.
    const timer = setTimeout(() => {
      const zh = language.startsWith("zh");
      const instruction = [
        zh
          ? "为用户在写作软件 Textus 的 Agent 首页生成 4 条起始建议。"
          : "Write 4 starting suggestions for the Agent home of the writing app Textus.",
        hasDocument
          ? zh
            ? "建议要针对当前文档的具体内容（文档在上下文中提供），例如润色某一节、补充某个论点、续写、生成配图说明等。"
            : "Tailor them to the current document (provided as context): e.g. polishing a particular section, strengthening a point, continuing it."
          : zh
            ? "当前文档为空：给出 4 个不同类型、具体而有趣的写作任务（如名著概要、文章大纲、故事、实用文书）。"
            : "The document is empty: give 4 varied, concrete and appealing writing tasks (e.g. a book summary, an article outline, a story, a practical document).",
        zh
          ? "每条包含 label（不超过 8 个汉字）和 prompt（60–140 字，具体可直接发送的指令，包含主题、篇幅、结构等细节）。"
          : "Each has a label (at most 4 words) and a prompt (25–60 words: a concrete, ready-to-send request with topic, length and structure).",
        zh
          ? '只输出 JSON 数组，例如 [{"label":"…","prompt":"…"}]，不要其他文字，不要调用工具，不要修改文档。'
          : 'Output ONLY a JSON array like [{"label":"…","prompt":"…"}], no other text; do not call tools or edit the document.',
        zh ? "使用中文。" : "Use the interface language.",
      ].join("\n");
      void quickText(settings, excerpt, instruction, requestId)
        .then((text) => {
          if (cancelled) return;
          const items = parseSuggestions(text);
          if (!items) return;
          sessionStorage.setItem(key, JSON.stringify(items));
          setGenerated({ key, items });
        })
        .catch(() => {
          // Offline or no provider: the fallbacks stay.
        });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void ai.cancelAgentMessage(requestId).catch(() => {});
    };
    // settings is read at call time; the key covers what changes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  const items =
    enabled && generated?.key === key
      ? generated.items
      : fallbackSuggestions(language, hasDocument);
  return { items, ai: enabled && generated?.key === key };
}

/** A concise title for an untitled document's first accepted draft. */
export async function suggestTitle(
  settings: Settings,
  markdown: string,
): Promise<string | null> {
  const zh = settings.language.startsWith("zh");
  const text = await quickText(
    settings,
    markdown.slice(0, 4000),
    zh
      ? "为这篇文档起一个简洁、准确的标题（不超过 20 个字）。只输出标题本身，不要引号、不要解释、不要调用工具。"
      : "Give this document a concise, accurate title (at most 10 words). Output only the title - no quotes, no explanation, no tools.",
    crypto.randomUUID(),
  );
  const title = text
    .split("\n")
    .map((line) =>
      line
        .replace(/^#+\s*/, "")
        // Surrounding quotes only; 《书名》 inside a title stays.
        .replace(/^["“'](.*)["”']$/, "$1")
        .trim(),
    )
    .find(Boolean);
  return title && [...title].length <= 60 ? title : null;
}

/** One turn of the image-prompt conversation (PromptRefiner). */
export interface PromptTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Rewrites an image prompt from the user's note ("warmer light", "only Sun
 * Wukong, no crowd"), keeping what they did not ask to change. Returns the
 * new prompt alone.
 */
export async function refineImagePrompt(
  settings: Settings,
  args: {
    prompt: string;
    anchor: string;
    instruction: string;
    history: PromptTurn[];
  },
): Promise<string> {
  const zh = settings.language.startsWith("zh");
  const transcript = args.history
    .map((turn) => `${turn.role === "user" ? "User" : "Prompt"}: ${turn.text}`)
    .join("\n");
  const text = await quickText(
    settings,
    args.anchor,
    [
      zh
        ? "你在帮用户修改一张插图的生成提示词。文档中这张图所配的段落已作为上下文提供。"
        : "You are helping the user revise the generation prompt for one illustration. The passage it illustrates is provided as context.",
      `${zh ? "当前提示词" : "Current prompt"}:\n${args.prompt}`,
      transcript
        ? `${zh ? "此前的修改" : "Earlier revisions"}:\n${transcript}`
        : "",
      `${zh ? "用户这次的要求" : "The user's request"}:\n${args.instruction}`,
      zh
        ? "按要求改写提示词：保留用户没有要求改动的主体、构图与风格；描述具体的主体、动作、构图、光线、色彩与画风；不超过 900 字。只输出新的提示词本身，不要解释、不要引号、不要调用工具。"
        : "Rewrite the prompt accordingly: keep the subject, composition and style the user did not ask to change; describe concrete subjects, action, composition, lighting, colour and medium; at most 900 characters. Output only the new prompt - no explanation, no quotes, no tools.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    crypto.randomUUID(),
  );
  return text.replace(/^```\w*\n?|```$/g, "").trim();
}
