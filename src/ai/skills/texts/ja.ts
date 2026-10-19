import type { SkillTexts } from "../builtin";

/** Japanese. 補完 is the UI's word for inline completion: not a label. */
export default {
  "continue-story": {
    label: "続きを書く",
    hint: "あなたの文体で次の場面を書き、ライブラリの設定と矛盾させません",
    aliases: ["続き"],
  },
  describe: {
    label: "情景・人物を描写",
    hint: "人物や場所、場面に具体的で五感に訴える描写を加えます",
    aliases: ["描写"],
  },
  dialogue: {
    label: "会話文を整える",
    hint: "文書の言語の決まりに沿って、会話文の記号や話者の示し方を整えます",
    aliases: ["会話文", "台詞"],
  },
  "imitate-style": {
    label: "文体をまねる",
    hint: "見本の文章や文体プロファイルの文体で書き直します",
    aliases: ["文体模写"],
  },
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
  "change-tone": {
    label: "口調を変える",
    hint: "より改まった、平易な、温かい、またはきっぱりした調子にします",
    aliases: ["口調", "敬体", "常体"],
  },
  "de-ai": {
    label: "AIっぽさを消す",
    hint: "AIにありがちな言い回しを取り除くか、指摘だけします",
    aliases: ["AIっぽさ"],
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
  email: {
    label: "メールを書く",
    hint: "メールや手紙を下書きしたり、構成を整えたりします",
    aliases: ["メール", "ビジネスメール"],
  },
  notice: {
    label: "お知らせ・公用文",
    hint: "お知らせや公用文を作成・修正します",
    aliases: ["公用文", "お知らせ"],
  },
  minutes: {
    label: "議事録",
    hint: "メモを決定事項と対応事項にまとめます",
    aliases: [],
  },
  "academic-polish": {
    label: "論文の推敲",
    hint: "改まった、慎重な学術的表現に整えます。引用はそのままです",
    aliases: ["論文", "学術"],
  },
  "social-post": {
    label: "SNS投稿",
    hint: "プラットフォームの文字数や決まりに合った投稿を書きます",
    aliases: ["投稿", "ポスト"],
  },
  headline: {
    label: "見出し・タイトル",
    hint: "内容に合った、ちょうどよい長さのタイトルを付けます",
    aliases: ["タイトル", "見出し", "件名"],
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
} satisfies SkillTexts;
