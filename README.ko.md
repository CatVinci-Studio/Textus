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

| 플랫폼 | 다운로드 | 다른 설치 방법 |
| --- | --- | --- |
| macOS · Apple 실리콘 | [.dmg 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest) | Homebrew: `brew install --cask textus` |
| macOS · Intel | [.dmg 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest) | Homebrew: `brew install --cask textus` |
| Windows · x64 | [.exe 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest) | — |
| Linux · x64 | [.AppImage 다운로드](https://github.com/CatVinci-Studio/Textus/releases/latest) · 또는 .deb · .rpm | Arch Linux: [`[catvinci]` 저장소](https://github.com/CatVinci-Studio/arch-repo) |

> iOS·iPadOS 버전도 곧 나옵니다.

베타: **설정 › 일반 › Textus 정보**에서 **업데이트 채널**을 **베타**로 바꾸세요.

## 글쓰기

보이는 그대로, 입력하는 대로 Markdown 서식이 잡힙니다. PDF, Word, HTML 등으로 내보낼 수 있습니다.

<p align="center">
  <img src="docs/images/readme/ko/markdown.webp" alt="제목, 굵게와 기울임, 인용, 목록, 할 일, 링크, 각주 등 모든 Markdown 표기를 쓴 문서가 서식대로 보인다" width="860" />
</p>

| 코드 블록 | 표 |
| :---: | :---: |
| <img src="docs/images/readme/ko/code.webp" alt="언어에 맞게 색이 입혀진 코드 블록" width="420" /> | <img src="docs/images/readme/ko/table.webp" alt="열이 맞춰진 표" width="420" /> |
| **수식** | **다이어그램** |
| <img src="docs/images/readme/ko/formula.webp" alt="입력하는 대로 그려지는 수식" width="420" /> | <img src="docs/images/readme/ko/diagram.webp" alt="Mermaid 순서도" width="420" /> |

## Textus AI

온라인 LLM도 로컬 LLM도 지원합니다. AI가 글쓰기에 속도를 더합니다.

| 이어 쓰기 | 오타와 문법 | 수정 제안 |
| :---: | :---: | :---: |
| <img src="docs/images/readme/ko/ai-continue.webp" alt="멈추면 다음 말이 회색으로 나타나고, Tab으로 수락" width="280" /> | <img src="docs/images/readme/ko/ai-grammar.webp" alt="잘못된 곳에 밑줄, Alt+Enter로 수정" width="280" /> | <img src="docs/images/readme/ko/ai-revise.webp" alt="문장별 수정 제안, 각각 이유와 함께" width="280" /> |
| **검토 댓글** | **슬래시 스킬** | **원하는 모델** |
| <img src="docs/images/readme/ko/ai-review.webp" alt="해당 문장에 붙은 댓글" width="280" /> | <img src="docs/images/readme/ko/ai-skills.webp" alt="/로 여는 스킬 메뉴" width="280" /> | <img src="docs/images/readme/ko/ai-models.webp" alt="설정에서 제공업체 선택" width="280" /> |

## 플러그인 (테스트 중, 1.3 beta)

글쓰기만이 아닙니다. 필요한 나머지는 플러그인으로 더하세요.

| 그래프 보기 | Vim |
| :---: | :---: |
| <img src="docs/images/readme/ko/plugin-graph.webp" alt="노트와 링크를 그린 그래프" width="420" /> | <img src="docs/images/readme/ko/plugin-vim.webp" alt="Vim의 점프 라벨과 창 막대의 모드 표시" width="420" /> |
| **빠른 미리보기** | **버전 기록** |
| <img src="docs/images/readme/ko/plugin-preview.webp" alt="링크 위에 멈추면 그 노트가 카드로 보인다" width="420" /> | <img src="docs/images/readme/ko/plugin-history.webp" alt="노트의 이전 버전을 옆에 표시" width="420" /> |

칸반 보드, 탭에서 여는 PDF와 Word, Zotero 인용, 다양한 차트 등은 **설정 › 확장 › 더 받기**에 있습니다.

## 자주 묻는 질문

<details>
<summary><strong>Textus는 무료인가요?</strong></summary>

네. MIT 라이선스의 무료 오픈 소스이며, 계정도 구독도 필요 없습니다. Textus AI 사용료는 선택한 제공업체가 직접 청구하고, 로컬 모델은 비용이 들지 않습니다.

</details>

<details>
<summary><strong>어떤 운영체제에서 쓸 수 있나요?</strong></summary>

macOS(Apple 실리콘·Intel), Windows, Linux에서 쓸 수 있습니다. iOS·iPadOS 버전도 곧 나옵니다.

</details>

<details>
<summary><strong>메모리는 얼마나 쓰나요?</strong></summary>

저희는 메모리 사용량을 매우 중요하게 여기고, 릴리스마다 측정합니다. 창 하나에 약 110 MB, 창을 하나 더 열 때마다 약 55 MB가 늘어납니다. 플러그인은 쓸 때만 불러오고, 백그라운드에 둔 웹 페이지는 메모리에서 내려졌다가 다시 돌아오면 새로 불러옵니다.

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
