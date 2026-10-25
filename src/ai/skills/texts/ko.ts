import type { SkillTexts } from "../builtin";

/** Korean. 이어 쓰기 is the UI's word for inline completion: not a label. */
export default {
  "continue-story": {
    label: "다음 장면 쓰기",
    hint: "내 문체로 다음 장면을 쓰고, 라이브러리 설정과 맞춥니다",
    aliases: ["이어서 쓰기", "이어서쓰기", "다음 이야기"],
  },
  describe: {
    label: "인물·장면 묘사",
    hint: "인물, 장소, 장면에 구체적이고 감각적인 묘사를 더합니다",
    aliases: ["묘사"],
  },
  dialogue: {
    label: "대사 다듬기",
    hint: "문서 언어의 규칙에 맞게 대사의 문장 부호와 인용 표현을 바로잡습니다",
    aliases: ["대사", "대화문"],
  },
  "imitate-style": {
    label: "문체 따라 쓰기",
    hint: "예문이나 문체 프로필의 문체로 다시 씁니다",
    aliases: ["문체 모방"],
  },
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
  "change-tone": {
    label: "어조 바꾸기",
    hint: "더 격식 있게, 쉽게, 따뜻하게 또는 단호하게 바꿉니다",
    aliases: ["어조", "말투"],
  },
  "de-ai": {
    label: "AI 티 없애기",
    hint: "AI 특유의 상투적인 표현을 걷어 내거나 짚어 주기만 합니다",
    aliases: ["AI티", "AI 말투"],
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
  email: {
    label: "이메일 쓰기",
    hint: "이메일이나 편지의 초안을 쓰거나 구성을 다듬습니다",
    aliases: ["이메일", "메일", "답장"],
  },
  notice: {
    label: "공문서·공지",
    hint: "공지나 공문서를 작성하거나 고칩니다",
    aliases: ["공문", "공지"],
  },
  minutes: {
    label: "회의록",
    hint: "메모를 결정 사항과 할 일로 정리합니다",
    aliases: [],
  },
  "academic-polish": {
    label: "논문 다듬기",
    hint: "논문과 연구계획서를 상투적 표현 없이 정확하고 절제된 학술 문체로 다듬고, 수치와 인용은 그대로 둡니다",
    aliases: ["논문", "학술", "연구계획서"],
  },
  "social-post": {
    label: "SNS 게시물",
    hint: "플랫폼의 글자 수와 규칙에 맞는 게시물을 씁니다",
    aliases: ["게시물"],
  },
  headline: {
    label: "제목 짓기",
    hint: "내용에 맞고 길이가 알맞은 제목을 붙입니다",
    aliases: ["제목"],
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
} satisfies SkillTexts;
