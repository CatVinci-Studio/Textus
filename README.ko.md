<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>차세대 Markdown 편집기</strong><br>
  붓 가는 대로 글이 되고, 먹은 AI가 갈아 줍니다
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>웹사이트</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>다운로드</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  한국어 ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.pt.md">Português</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Textus"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
  <a href="https://github.com/CatVinci-Studio/Textus/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CatVinci-Studio/Textus/ci.yml?branch=main&label=CI"></a>
  <a href="https://textus.catvinci.com/discord"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/jaywcjlove/awesome-mac"><img alt="Awesome Mac" src="https://img.shields.io/badge/Awesome-Mac-FC60A8?logo=awesomelists&logoColor=white"></a>
</p>

https://github.com/user-attachments/assets/f366f282-e3f9-43d9-9a29-edb6d1ace3f5

<p align="center">
  <a href="https://www.youtube.com/watch?v=k_ew9TRljz0">YouTube에서 보기</a> ·
  <a href="https://www.bilibili.com/video/BV19LJb6WEWb">Bilibili</a>
</p>

<p align="center">
  <img src="docs/images/readme/ko/hero.png" alt="『메밀꽃 필 무렵』과 독서 메모를 연 Textus. Textus AI가 메모를 문장마다 다듬어 여백에 보여 주고, 원문 옆에 검토 메모를 남겼습니다." width="860" /><br>
  <sub>이효석, <i>「메밀꽃 필 무렵」</i></sub>
</p>

## Textus 시작하기

MIT 라이선스로 공개된 무료 오픈 소스입니다.

| 플랫폼               | 다운로드                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| macOS · Apple 실리콘 | [.dmg 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| macOS · Intel     | [.dmg 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| Windows · x64     | [.exe 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| Linux · x64       | [.AppImage 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest) · 또는 .deb · .rpm |

Homebrew로도 설치할 수 있습니다:

```sh
brew install --cask textus
```

Arch Linux는 서명된 [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) pacman 저장소로(한 번만 설정하면 이후 `sudo pacman -Syu`로 Textus도 최신 상태가 됩니다):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

iPhone·iPad 버전도 곧 나옵니다. [GitHub에서 모든 릴리스 보기](https://github.com/CatVinci-Studio/Textus/releases)

새 버전을 먼저 써 보고 싶다면 **설정 › 일반 › Textus 정보**에서 **업데이트 채널**을 **베타**로 바꾸세요. 출시 후보 버전도 받게 됩니다. 언제든 **안정 버전**으로 되돌릴 수 있으며, 되돌린 뒤에는 더 새로운 안정 버전이 나올 때까지 지금 버전을 유지합니다.

## 글쓰기

어떤 Markdown 표기든 쓰는 즉시 서식으로 바뀝니다. 줄을 가리키면 원래 표기가 보입니다.

<p align="center">
  <img src="docs/images/readme/ko/markdown.png" alt="보이는 그대로" width="860" />
</p>

수식은 입력하는 대로 그려지고, 표는 저절로 줄을 맞춥니다. 글 몇 줄이면 다이어그램이 됩니다.

<p align="center">
  <img src="docs/images/readme/ko/math.png" alt="수식, 표, 다이어그램을 한 번에" width="860" />
</p>

### 글 쓰는 방식은? 마음 가는 대로

네 가지 쓰기 모드를 자유롭게 오가고, Typora 테마까지 원하는 테마로 바로 바꿀 수 있습니다.

| 쓰기 모드    | 하는 일                                  |
| -------- | ------------------------------------- |
| 젠 모드     | 글 외의 모든 것이 물러납니다                      |
| 타자기 모드   | 지금 쓰는 줄이 늘 같은 높이에 머뭅니다                |
| 분할 보기    | 한쪽에서 Markdown을 쓰고, 다른 쪽에서 완성된 모습을 봅니다 |
| 소스 코드 모드 | 문서 전체를 Markdown 원문 그대로 다룹니다           |

<p align="center">
  <img src="docs/images/readme/ko/split.png" alt="분할 보기" width="49%" />
  <img src="docs/images/readme/ko/zen.png" alt="젠 모드" width="49%" />
</p>

PDF, Word, HTML 등으로 내보낼 수 있습니다.

## Textus AI

당신의 글쓰기 도우미, 함께 씁니다.

### 쓰는 동안

손을 멈추면 다음 말이 회색으로 떠오릅니다. Tab 키로 수락하세요. 쓰는 동안 오타와 문법 오류를 짚어 주고, 내 표기 규칙도 함께 확인합니다. Alt+Enter로 바로 고칩니다.

### 부탁하면

고칠 곳은 이유와 함께 제안으로 옵니다. 통째로 수락하거나 문장별로 고르세요. 댓글이 해당 문장 옆에 붙습니다. 글을 고치지 않고 의견만 남깁니다. 간결하게, 교정, 번역, 어조 바꾸기까지. 슬래시(/) 하나면 됩니다.

### 나를 아는 AI

내 문체를 익히고, 인물과 장소를 기억하며, 내가 정한 지침을 따릅니다.

### 원하는 LLM으로

Textus는 20개가 넘는 LLM을 지원하며, OpenAI 호환 API를 제공하는 LLM이라면 무엇이든 쓸 수 있습니다.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Doubao · Ollama · OpenAI 호환 엔드포인트

<p align="center">
  <img src="docs/images/readme/ko/settings.png" alt="원하는 LLM으로" width="860" />
</p>

## 당신이 쓴 글은 오직 당신의 것

내 글은 내 것입니다. Textus는 처음부터 그렇게 설계되었고, 코드는 누구나 확인할 수 있습니다.

문서는 원하는 곳에 저장하는 일반 Markdown 파일입니다. API 키와 로그인 정보는 내 컴퓨터에만 저장됩니다. AI 요청은 내 기기에서 내가 고른 제공업체로 바로 전송됩니다. 내려받아 바로 쓰면 됩니다. 가입할 필요가 없습니다. 분석도, 원격 측정도, 광고도 없습니다. MIT 라이선스로 모든 코드를 공개합니다. 위의 내용은 누구나 확인할 수 있습니다. Ollama로 로컬 모델을 쓰면 글이 내 컴퓨터 밖으로 나가지 않습니다.

## 자주 묻는 질문

<details>
<summary><strong>Textus는 무료인가요?</strong></summary>

네. MIT 라이선스의 무료 오픈 소스이며, 계정도 구독도 필요 없습니다. Textus AI 사용료는 선택한 제공업체가 직접 청구하고, 로컬 모델은 비용이 들지 않습니다.

</details>

<details>
<summary><strong>어떤 운영체제에서 쓸 수 있나요?</strong></summary>

macOS(Apple 실리콘·Intel), Windows, Linux에서 쓸 수 있습니다. iPhone·iPad 버전도 준비 중입니다.

</details>

<details>
<summary><strong>AI 계정이 필요한가요?</strong></summary>

아니요. 편집기의 모든 기능은 AI 없이도 쓸 수 있습니다. Textus AI를 쓰려면 제공업체를 직접 연결하세요. ChatGPT나 Claude 계정으로 로그인하거나, API 키를 입력하거나, Ollama로 로컬 모델을 실행하면 됩니다.

</details>

<details>
<summary><strong>인터넷 없이도 쓸 수 있나요?</strong></summary>

편집기는 완전히 오프라인으로 작동합니다. Textus AI는 제공업체와 연결되어야 하지만, 로컬 모델을 쓰면 인터넷이 필요 없습니다.

</details>

<details>
<summary><strong>일반 Markdown 파일인가요?</strong></summary>

네. 일반 .md 파일이며 표, 할 일 목록, 각주, 수식, Mermaid를 지원합니다. PDF, Word, HTML 등으로 내보낼 수 있습니다.

</details>

## 빠른 시작

1. Textus를 실행합니다. 빈 초안에서 시작하며, 파일은 저장할 때만 정하면 됩니다.
2. **설정 → Textus AI**를 열어 제공업체를 고르고, **로그인 및 인증 정보**에서 로그인하거나 키를 붙여 넣습니다.
3. 쓰기 시작하세요. 잠시 멈추면 다음 문장이 회색으로 나타나고, Tab으로 받아들입니다.
4. 창 막대의 **Textus AI** 버튼(로봇)으로 AI 패널을 엽니다. 나머지는 **도움말 → AI 기능 가이드**에 있습니다.

모든 단축키는 **설정 → 단축키**에서 확인하고 바꿀 수 있습니다.

## 커뮤니티

- [Discord](https://textus.catvinci.com/discord): 공지, 도움말, 피드백 (영어)
- 중국어: [QQ 그룹](https://textus.catvinci.com/qq) (1128285004) · [WeChat 그룹](https://textus.catvinci.com/wechat)

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues)에 남겨 주세요.

## 로드맵과 개발 참여

Textus의 앞으로의 방향은 [ROADMAP.md](ROADMAP.md)(영어)에 있습니다. 빌드, 검사 실행, 풀 리퀘스트는 [CONTRIBUTING.md](CONTRIBUTING.md)(영어)부터 시작하세요. AI 코딩 도우미는 [AGENTS.md](AGENTS.md)를 따릅니다. 논의는 영어나 중국어로 해 주세요.

## 스타 추이

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## 라이선스

[MIT](./LICENSE) © CatVinci Studio
