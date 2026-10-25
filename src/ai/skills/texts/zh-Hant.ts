import type { SkillTexts } from "../builtin";

/** Traditional Chinese (Taiwan). 續寫 is the UI's word for inline
 *  completion, so it is only an alias here, never a label. */
export default {
  expand: {
    label: "擴寫",
    hint: "讓段落更充實，不加入新的事實",
    aliases: ["展開"],
  },
  tighten: {
    label: "精簡",
    hint: "刪掉冗詞贅句，事實一個不少",
    aliases: ["壓縮"],
  },
  translate: {
    label: "翻譯潤飾",
    hint: "譯成讀起來像母語寫作的文字",
    aliases: ["翻譯"],
  },
  proofread: {
    label: "校對",
    hint: "依語言規範檢查錯字、標點和數字",
    aliases: ["校稿", "挑錯"],
  },
  continuity: {
    label: "檢查前後一致",
    hint: "找出與資料庫或其他章節矛盾的地方",
    aliases: ["設定檢查"],
  },
  summarize: {
    label: "摘要",
    hint: "依你要的篇幅忠實摘要",
    aliases: ["總結", "概述"],
  },
  theme: {
    label: "設計主題",
    hint: "依你的描述寫一份編輯器主題，可直接使用",
    aliases: ["主題", "編輯器主題"],
  },
  plugin: {
    label: "做外掛",
    hint: "依你的描述做一個 Textus 小外掛，一鍵安裝",
    aliases: ["外掛", "小工具", "擴充"],
  },
  skill: {
    label: "生成技能",
    hint: "把常做的任務存成一個技能，用 / 呼叫",
    aliases: ["做技能", "新增技能"],
  },
} satisfies SkillTexts;
