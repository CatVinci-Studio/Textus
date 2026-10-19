import type { SkillTexts } from "../builtin";

/** Simplified Chinese. 续写 is the UI's word for inline completion, so it is
 *  only an alias here, never a label. */
export default {
  "continue-story": {
    label: "接着写",
    hint: "用你的文风写下一节，与资料库保持一致",
    aliases: ["续写", "写下一节", "下一章"],
  },
  describe: {
    label: "描写人物或场景",
    hint: "为人物、地点或场景添上具体可感的细节",
    aliases: ["描写", "场景描写", "人物描写"],
  },
  dialogue: {
    label: "对话润色",
    hint: "按文档语言的规范理顺对话的标点和提示语",
    aliases: ["对话", "对白"],
  },
  "imitate-style": {
    label: "模仿文风",
    hint: "照着范文或你的文风档案改写",
    aliases: ["仿写", "文风"],
  },
  expand: {
    label: "扩写",
    hint: "让段落更充实，不添加新的事实",
    aliases: ["展开", "扩充"],
  },
  tighten: {
    label: "精简",
    hint: "删掉冗词赘句，事实一个不少",
    aliases: ["压缩", "删减"],
  },
  "change-tone": {
    label: "调整语气",
    hint: "改得更正式、更平实、更亲切或更坚定",
    aliases: ["语气", "改正式"],
  },
  "de-ai": {
    label: "去 AI 味",
    hint: "去掉套路化的 AI 腔，或者只把它标出来",
    aliases: ["去AI味", "AI味"],
  },
  translate: {
    label: "翻译润色",
    hint: "译成读起来像母语写作的文字",
    aliases: ["翻译", "译成"],
  },
  proofread: {
    label: "校对",
    hint: "按语言规范检查错别字、标点和数字",
    aliases: ["查错", "挑错", "校稿"],
  },
  continuity: {
    label: "检查前后一致",
    hint: "找出与资料库或其他章节矛盾的地方",
    aliases: ["设定检查", "前后矛盾"],
  },
  email: {
    label: "写邮件",
    hint: "起草或重新组织一封邮件或书信",
    aliases: ["邮件", "回信", "书信"],
  },
  notice: {
    label: "公文与通知",
    hint: "起草或修改通知、请示等公文",
    aliases: ["公文", "通知", "请示", "函"],
  },
  minutes: {
    label: "会议纪要",
    hint: "把会议记录整理成决定事项和待办",
    aliases: ["纪要", "会议记录"],
  },
  "academic-polish": {
    label: "学术润色",
    hint: "改成正式、分寸得当的学术表达，引文不动",
    aliases: ["论文润色", "学术"],
  },
  "social-post": {
    label: "社媒文案",
    hint: "写出符合平台字数和规则的帖子",
    aliases: ["朋友圈", "小红书", "公众号", "微博"],
  },
  headline: {
    label: "起标题",
    hint: "起一个准确、长短合适的标题",
    aliases: ["标题", "题目"],
  },
  summarize: {
    label: "总结摘要",
    hint: "按你要的篇幅如实概括",
    aliases: ["总结", "摘要", "概括"],
  },
  theme: {
    label: "设计主题",
    hint: "按你的描述写一份编辑器主题，可直接使用",
    aliases: ["主题", "编辑器主题"],
  },
} satisfies SkillTexts;
