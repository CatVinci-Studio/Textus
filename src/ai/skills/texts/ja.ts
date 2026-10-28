import type { SkillTexts } from "../builtin";

/** Japanese. 補完 is the UI's word for inline completion: not a label. */
export default {
  proofread: {
    label: "校正",
    hint: "言語の規範に沿って誤字・句読点・数字をチェックします",
    aliases: ["誤字チェック"],
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
