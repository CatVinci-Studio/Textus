import type { SkillTexts } from "../builtin";

/** Korean. 이어 쓰기 is the UI's word for inline completion: not a label. */
export default {
  expand: {
    label: "늘려 쓰기",
    hint: "사실을 더하지 않고 글을 풍성하게 만듭니다",
    aliases: ["확장"],
  },
  tighten: {
    label: "간결하게",
    hint: "군더더기를 덜어 내고 사실은 모두 남깁니다",
    aliases: ["줄이기", "압축"],
  },
  translate: {
    label: "번역 다듬기",
    hint: "원어민이 쓴 글처럼 읽히게 번역합니다",
    aliases: ["번역"],
  },
  proofread: {
    label: "교정",
    hint: "언어 규범에 맞춰 맞춤법, 문장 부호, 숫자를 확인합니다",
    aliases: ["맞춤법", "맞춤법 검사"],
  },
  continuity: {
    label: "설정 오류 확인",
    hint: "라이브러리나 다른 장과 어긋나는 부분을 찾습니다",
    aliases: ["설정 확인"],
  },
  summarize: {
    label: "요약",
    hint: "원하는 길이로 충실하게 요약합니다",
    aliases: ["정리"],
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
