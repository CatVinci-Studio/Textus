/**
 * Auto-writing (AutoWriter.tsx): the user keeps an outline, requirements and
 * notes - text, Word or PDF - and pictures in the project folder; the model
 * turns them into a plan of sections, then writes the document one section
 * at a time, each section a reviewed draft, using the folder's own pictures
 * where they fit. These are the pure parts - which files look like a plan,
 * the prompts, and reading the planned outline back.
 */

import { taskBriefBlock } from "../chat/user-message";

export interface PlannedSection {
  title: string;
  /** What the section covers, from the plan files. */
  brief: string;
  /** A target length in characters/words, as the plan suggests. */
  length: number;
  /** Whether this section should get a generated illustration. */
  image: boolean;
  /** One of the project's own pictures for it (its path in the folder). */
  picture?: string;
}

export interface WritingPlan {
  /** The document's title. */
  title: string;
  /** The standing requirements every section follows (tone, audience,
   *  terminology, format), condensed from the plan files. */
  guide: string;
  sections: PlannedSection[];
}

/** Names that suggest planning material, checked by default. */
const PLAN_NAME =
  /(大纲|提纲|纲要|要求|需求|设定|规划|计划|说明|笔记|素材|人物|outline|brief|plan|requirement|spec|notes?|style|synopsis|character)/i;

export function looksLikePlanFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    /\.(md|markdown|txt|text|docx|pdf|pptx)$/i.test(name) &&
    PLAN_NAME.test(name)
  );
}

/** The plan files' text for the prompt, each labelled, within a budget so a
 *  large folder cannot blow up the request (the cost the user pays). Each
 *  file gets an even share - a long PDF first in line used to leave the
 *  outline after it nothing. */
export function planMaterial(
  files: { path: string; text: string }[],
  budget = 24_000,
): string {
  const share = Math.ceil(budget / Math.max(files.length, 1));
  return files
    .map((file) => {
      const text = file.text.trim();
      const more = text.length > share ? "\n[…]" : "";
      return `<file path="${file.path}">\n${text.slice(0, share)}${more}\n</file>`;
    })
    .join("\n\n");
}

/** How a document shows the project picture `rel`: relative to the
 *  document's folder when it sits under it, else by absolute path -
 *  encoded where markdown would break (as ai::project::image_src). */
export function pictureSrc(
  root: string,
  rel: string,
  docPath: string | null,
): string {
  const abs = `${root.replace(/[\\/]+$/, "")}/${rel}`;
  const dir = docPath ? docPath.replace(/[\\/][^\\/]*$/, "") : null;
  const path =
    dir && abs.startsWith(`${dir}/`) ? abs.slice(dir.length + 1) : abs;
  return path
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

export function planningPrompt(
  material: string,
  extra: string,
  zh: boolean,
  images = false,
  /** The project's own pictures the sections may use. */
  pictures: string[] = [],
): string {
  const listed = pictures.map((p) => `- ${p}`).join("\n");
  return [
    zh
      ? "你是写作项目的规划助手。下面是用户在项目文件夹里准备的提纲、大纲、要求等资料。请据此规划要写的文档。"
      : "You plan a writing project. Below is the outline, requirements and notes the user prepared in their project folder. Plan the document from them.",
    material,
    extra.trim()
      ? `${zh ? "用户补充要求" : "Further requirements from the user"}:\n${extra.trim()}`
      : "",
    zh
      ? '只输出一个 JSON 对象：{"title":"文档标题","guide":"所有章节都要遵守的写作要求摘要（文风、受众、篇幅、术语、格式等，300 字以内）","sections":[{"title":"章节标题","brief":"本节要写的要点（100 字以内）","length":本节建议字数,"image":是否适合配一张插图}]}。章节顺序即写作顺序，严格依据资料，不要编造资料中没有的结构；没有明确大纲时按资料内容合理拆成 3–8 节。不要调用工具，不要输出其他文字。'
      : 'Output ONLY a JSON object: {"title":"document title","guide":"the requirements every section must follow (tone, audience, length, terminology, format) in under 80 words","sections":[{"title":"section heading","brief":"what this section covers, under 40 words","length":suggested words,"image":whether it suits one illustration}]}. Sections in writing order, following the material; without an explicit outline, split the content into 3-8 sections. No tools, no other text.',
    pictures.length
      ? zh
        ? `项目里已有这些图片：\n${listed}\n内容合适的章节直接用其中一张：在该节写 "picture":"图片路径"（照抄上面的路径），每张最多用一次。`
        : `The project already has these pictures:\n${listed}\nGive a section one of them when it fits: "picture":"its path" (copied from above), each used at most once.`
      : "",
    images
      ? zh
        ? '用户开启了配图：没有合适的现成图片、又适合配图的 1–3 节（约每三节一张）标为 "image":true，会为它生成插图。'
        : 'The user switched illustrations on: mark the 1-3 sections without a fitting existing picture that suit one best (about one in three) with "image":true - one is generated for them.'
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parsePlan(
  text: string,
  /** The pictures a section may name; anything else is dropped. */
  pictures: string[] = [],
): WritingPlan | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<WritingPlan> & {
      sections?: Partial<PlannedSection>[];
    };
    const used = new Set<string>();
    const sections = (value.sections ?? [])
      .filter((s) => typeof s?.title === "string" && s.title.trim())
      .slice(0, 30)
      .map((s): PlannedSection => {
        const picture =
          typeof s.picture === "string" &&
          pictures.includes(s.picture) &&
          !used.has(s.picture)
            ? s.picture
            : undefined;
        if (picture) used.add(picture);
        return {
          title: String(s.title).trim(),
          brief: typeof s.brief === "string" ? s.brief.trim() : "",
          length:
            typeof s.length === "number" && s.length > 0
              ? Math.min(Math.round(s.length), 5000)
              : 600,
          image: !picture && s.image === true,
          ...(picture ? { picture } : {}),
        };
      });
    if (!sections.length) return null;
    return {
      title: typeof value.title === "string" ? value.title.trim() : "",
      guide: typeof value.guide === "string" ? value.guide.trim() : "",
      sections,
    };
  } catch {
    return null;
  }
}

/** With illustrations on, a plan always has pictures: when the model gave
 *  none, about one section in three gets one generated, from the first. */
export function ensureIllustrated(plan: WritingPlan): WritingPlan {
  if (plan.sections.some((s) => s.image || s.picture)) return plan;
  return {
    ...plan,
    sections: plan.sections.map((s, i) => ({ ...s, image: i % 3 === 0 })),
  };
}

/** One section's request. Self-contained - the plan's guide and the outline
 *  ride along, the document itself is sent by the agent loop - so a long
 *  run does not depend on an ever-growing conversation. */
export function sectionPrompt(
  plan: WritingPlan,
  index: number,
  options: {
    images: boolean;
    first: boolean;
    revision?: string;
    /** The section's own picture, as the document shows it. */
    pictureSrc?: string;
  },
  zh: boolean,
): string {
  const section = plan.sections[index];
  const outline = plan.sections
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}${i === index ? (zh ? "  ← 本节" : "  ← this one") : ""}`,
    )
    .join("\n");
  const generate = options.images && section.image && !options.pictureSrc;
  const lines = zh
    ? [
        `【自动写作 ${index + 1}/${plan.sections.length}】请写第 ${index + 1} 节「${section.title}」。`,
        section.brief ? `本节要点：${section.brief}` : "",
        `建议篇幅：约 ${section.length} 字。`,
        plan.guide ? `写作要求：${plan.guide}` : "",
        `全文大纲：\n${outline}`,
        options.first && plan.title
          ? `这是第一节：如果文档还没有一级标题，先写一级标题「${plan.title}」，再写本节。`
          : "",
        `用 propose_edit 的 append 把本节追加到文末，以二级标题「${section.title}」开头；不要改动已有内容，不要写其他章节，与前文自然衔接、不重复。`,
        options.pictureSrc
          ? `本节使用项目里已有的图片：在最适合的那一段之后，单独一行写 ![简短的图片说明](${options.pictureSrc})，路径照抄，不要生成新图。`
          : "",
        generate
          ? "本节写完后，用 generate_image 为本节配一张插图：提示词由你根据本节内容来写，锚点选本节中最适合放图的那一段的原文（图片放在它后面），无需用户确认。"
          : "",
        options.revision
          ? `用户对上一稿的修改意见：${options.revision}\n请据此重写本节。`
          : "",
      ]
    : [
        `[Auto-writing ${index + 1}/${plan.sections.length}] Write section ${index + 1}, "${section.title}".`,
        section.brief ? `Covers: ${section.brief}` : "",
        `Length: about ${section.length} words.`,
        plan.guide ? `Requirements: ${plan.guide}` : "",
        `Outline:\n${outline}`,
        options.first && plan.title
          ? `This is the first section: if the document has no level-one heading yet, start with "${plan.title}" as one, then the section.`
          : "",
        `Append the section to the end with propose_edit (append), starting with the level-two heading "${section.title}"; do not change existing text or write other sections; continue naturally from what precedes it without repeating it.`,
        options.pictureSrc
          ? `Use the project's own picture for this section: after the paragraph it suits best, on a line of its own, write ![a short caption](${options.pictureSrc}) with the path exactly as given - don't generate one.`
          : "",
        generate
          ? "Then illustrate it with generate_image: write the prompt yourself from the section, and anchor it to the paragraph the picture suits best (it goes right after it) - no approval needed."
          : "",
        options.revision
          ? `The user's notes on the previous draft: ${options.revision}\nRewrite the section accordingly.`
          : "",
      ];
  // The chat and the task list show one line per section; the brief goes
  // to the model in full (user-message.ts folds it out of the transcript).
  const visible = zh
    ? `【自动写作 ${index + 1}/${plan.sections.length}】${section.title}${options.revision ? `（按意见重写：${options.revision}）` : ""}`
    : `[Auto-writing ${index + 1}/${plan.sections.length}] ${section.title}${options.revision ? ` (rewrite: ${options.revision})` : ""}`;
  return `${visible}\n\n${taskBriefBlock(lines.filter(Boolean).join("\n"))}`;
}
