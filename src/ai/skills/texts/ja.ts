import type { SkillTexts } from "../builtin";

/** Japanese. 補完 is the UI's word for inline completion: not a label. */
export default {
  expand: {
    label: "膨らませる",
    hint: "事実を足さずに文章を厚くします",
    aliases: ["加筆"],
  },
  tighten: {
    label: "簡潔にする",
    hint: "冗長な表現を削り、事実はすべて残します",
    aliases: ["短く"],
  },
  translate: {
    label: "翻訳して整える",
    hint: "母語で書いたように読める訳文にします",
    aliases: ["翻訳"],
  },
  proofread: {
    label: "校正",
    hint: "言語の規範に沿って誤字・句読点・数字をチェックします",
    aliases: ["誤字チェック"],
  },
  continuity: {
    label: "設定の整合性チェック",
    hint: "ライブラリやほかの章との食い違いを見つけます",
    aliases: ["整合性"],
  },
  summarize: {
    label: "要約",
    hint: "指定した長さで忠実に要約します",
    aliases: ["まとめ", "要旨"],
  },
  theme: {
    label: "テーマを作る",
    hint: "説明に合わせてエディターのテーマを書き、すぐ使えます",
    aliases: ["テーマ", "テーマ作成"],
  },
  plugin: {
    label: "プラグインを作る",
    hint: "説明どおりの小さな Textus プラグインを作り、すぐ入れられる",
    aliases: ["プラグイン", "拡張"],
  },
  skill: {
    label: "スキルを作る",
    hint: "よく行う作業を / で呼べるスキルにします",
    aliases: ["スキル作成", "新しいスキル"],
  },
} satisfies SkillTexts;
