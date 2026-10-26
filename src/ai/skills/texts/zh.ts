import type { SkillTexts } from "../builtin";

/** Simplified Chinese. 续写 is the UI's word for inline completion, so it is
 *  only an alias here, never a label. */
export default {
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
  plugin: {
    label: "做插件",
    hint: "按你的描述做一个 Textus 小插件，一键安装",
    aliases: ["插件", "小工具", "扩展"],
  },
  skill: {
    label: "生成技能",
    hint: "把常做的任务存成一个技能，用 / 调用",
    aliases: ["做技能", "新建技能"],
  },
} satisfies SkillTexts;
