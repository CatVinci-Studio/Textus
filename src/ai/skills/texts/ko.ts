import type { SkillTexts } from "../builtin";

/** Korean. 이어 쓰기 is the UI's word for inline completion: not a label. */
export default {
  proofread: {
    label: "교정",
    hint: "언어 규범에 맞춰 맞춤법, 문장 부호, 숫자를 확인합니다",
    aliases: ["맞춤법", "맞춤법 검사"],
  },
  theme: {
    label: "테마 만들기",
    hint: "설명에 맞춰 편집기 테마를 만들어 바로 쓸 수 있습니다",
    aliases: ["테마"],
  },
  plugin: {
    label: "플러그인 만들기",
    hint: "설명대로 작은 Textus 플러그인을 만들어 바로 설치",
    aliases: ["플러그인", "확장 기능"],
  },
  skill: {
    label: "스킬 만들기",
    hint: "자주 하는 작업을 /로 부르는 스킬로 만듭니다",
    aliases: ["스킬 생성", "새 스킬"],
  },
} satisfies SkillTexts;
