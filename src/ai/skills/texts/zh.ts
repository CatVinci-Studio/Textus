import type { SkillTexts } from "../builtin";

/** Simplified Chinese. 续写 is the UI's word for inline completion, so it is
 *  only an alias here, never a label. */
export default {
  proofread: {
    label: "校对",
    hint: "按语言规范检查错别字、标点和数字",
    aliases: ["查错", "挑错", "校稿"],
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
