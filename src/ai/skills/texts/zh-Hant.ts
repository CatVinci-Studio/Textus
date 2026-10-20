import type { SkillTexts } from "../builtin";

/** Traditional Chinese (Taiwan). 續寫 is the UI's word for inline
 *  completion, so it is only an alias here, never a label. */
export default {
  "continue-story": {
    label: "接著寫",
    hint: "用你的文風寫下一節，與資料庫保持一致",
    aliases: ["續寫", "寫下一節"],
  },
  describe: {
    label: "描寫人物或場景",
    hint: "為人物、地點或場景加上具體可感的細節",
    aliases: ["描寫"],
  },
  dialogue: {
    label: "對話潤飾",
    hint: "依文件語言的規範整理對話的標點和提示語",
    aliases: ["對話", "對白"],
  },
  "imitate-style": {
    label: "模仿文風",
    hint: "照著範文或你的文風檔案改寫",
    aliases: ["仿寫"],
  },
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
  "change-tone": {
    label: "調整語氣",
    hint: "改得更正式、更平實、更親切或更堅定",
    aliases: ["語氣"],
  },
  "de-ai": {
    label: "去 AI 味",
    hint: "拿掉公式化的 AI 腔，或者只把它標出來",
    aliases: ["去AI味"],
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
  email: {
    label: "寫郵件",
    hint: "起草或重新整理一封郵件或書信",
    aliases: ["郵件", "回信"],
  },
  notice: {
    label: "公文與通知",
    hint: "起草或修改通知、函、簽等公文",
    aliases: ["公文", "函", "簽"],
  },
  minutes: {
    label: "會議紀錄",
    hint: "把會議筆記整理成決議事項和待辦",
    aliases: ["紀錄"],
  },
  "academic-polish": {
    label: "學術潤飾",
    hint: "論文與計畫書：正式、分寸得當，刪去套話，數字和引用不動",
    aliases: ["論文潤飾", "計畫書", "研究計畫書"],
  },
  "social-post": {
    label: "社群貼文",
    hint: "寫出符合平台字數和規則的貼文",
    aliases: ["貼文"],
  },
  headline: {
    label: "下標題",
    hint: "下一個準確、長短合適的標題",
    aliases: ["標題"],
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
} satisfies SkillTexts;
