<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>Markdown-редактор нового поколения.</strong><br>
  Перо в ваших руках. Чернила готовит ИИ.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Сайт</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Скачать</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  Русский ·
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
  <a href="https://www.youtube.com/watch?v=k_ew9TRljz0">Смотреть на YouTube</a> ·
  <a href="https://www.bilibili.com/video/BV19LJb6WEWb">Bilibili</a>
</p>

<p align="center">
  <img src="docs/images/readme/ru/hero.png" alt="Textus с открытым романом «Анна Каренина» и заметками читателя. Textus AI сокращает заметки по предложениям, каждая правка на полях, и оставляет комментарий рядом с текстом." width="860" /><br>
  <sub><i>«Анна Каренина»</i>, Лев Толстой</sub>
</p>

## Установите Textus

Бесплатно и с открытым кодом, по лицензии MIT.

| Платформа             | Скачать                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| macOS · Apple Silicon | [Скачать .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| macOS · Intel         | [Скачать .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| Windows · x64         | [Скачать .exe](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| Linux · x64           | [Скачать .AppImage](https://github.com/CatVinci-Studio/Textus/releases/latest) · А также .deb · .rpm |

Или через Homebrew:

```sh
brew install --cask textus
```

Arch Linux через подписанный pacman-репозиторий [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) (один раз; дальше `sudo pacman -Syu` будет обновлять Textus):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

iPhone и iPad — скоро. [Все версии на GitHub](https://github.com/CatVinci-Studio/Textus/releases)

Хотите получать новые версии раньше? В **Настройки › Основные › О Textus** выберите **Канал обновлений** **Бета** — тогда придут и предварительные версии. Вернуться на **Стабильный** можно в любой момент: вы останетесь на своей версии, пока не выйдет более новая стабильная.

## Редактор

Markdown оформляется прямо при наборе. Наведите курсор на строку — и увидите её разметку.

<p align="center">
  <img src="docs/images/readme/ru/markdown.png" alt="Что видишь, то и получаешь." width="860" />
</p>

Формулы отображаются по ходу ввода, таблицы выравниваются сами, а из пары строк текста получается диаграмма.

<p align="center">
  <img src="docs/images/readme/ru/math.png" alt="Формулы, таблицы, диаграммы – в одно касание." width="860" />
</p>

### Ваш стиль письма? Решать вам

Четыре режима письма и любая тема на ваш вкус – подойдут и темы Typora.

| Режимы письма         | Что делает                                          |
| --------------------- | --------------------------------------------------- |
| Режим дзен            | Всё, кроме текста, отходит на второй план           |
| Режим пишущей машинки | Строка, которую вы пишете, остаётся на одной высоте |
| Разделённый вид       | Markdown с одной стороны, готовая страница с другой |
| Режим исходного кода  | Весь документ в чистом Markdown                     |

<p align="center">
  <img src="docs/images/readme/ru/split.png" alt="Разделённый вид" width="49%" />
  <img src="docs/images/readme/ru/zen.png" alt="Режим дзен" width="49%" />
</p>

Экспорт в PDF, Word, HTML и другие форматы.

## Textus AI

Ваш помощник в письме. Пишет вместе с вами.

### Пока вы пишете

Остановитесь — и следующие слова появятся серым. Нажмите Tab, чтобы принять. Опечатки, ошибки и отступления от ваших норм оформления видны прямо при наборе. Исправить — Alt+Enter.

### Когда вы просите

Каждая правка — с объяснением. Примите её целиком или по предложениям. Комментарии прямо у нужных строк. Замечания, а не переписанный за вас текст. Сократить, вычитать, перевести, сменить тон и многое другое — достаточно набрать «/».

### Понимает вас

Перенимает ваш стиль, помнит ваших героев и места, следует вашим инструкциям.

### Любая LLM на ваш выбор

Textus работает более чем с 20 LLM и с любой LLM, у которой есть API, совместимый с OpenAI.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Doubao · Ollama · Любой сервис, совместимый с OpenAI

<p align="center">
  <img src="docs/images/readme/ru/settings.png" alt="Любая LLM на ваш выбор." width="860" />
</p>

## Плагины

Добавьте то, что нужно, и ничего лишнего. Граф заметок и ссылок между ними, карточка, показывающая, куда ведёт ссылка, два документа рядом, канбан-доски, история версий, PDF и Word во вкладке, цитаты из Zotero — всё в **Настройки › Расширения › Получить ещё**, рядом с темами и навыками. Каждый плагин спрашивает, прежде чем что-то использовать.

<p align="center">
  <img src="docs/images/readme/ru/plugins.png" alt="Заметки об «Анне Карениной» рядом с графом их ссылок; заметка, на которую ведёт ссылка, открыта в карточке." width="860" />
</p>

## То, что вы пишете, принадлежит только вам

Так устроен Textus, и убедиться в этом может каждый: его код открыт.

Документы — обычные файлы Markdown, и хранятся они там, где решите вы. API-ключи и данные для входа хранятся только на вашем компьютере. Запросы к ИИ идут прямо с вашего устройства к выбранному провайдеру. Скачайте и пишите. Регистрация не нужна. Никакой аналитики, телеметрии и рекламы. Лицензия MIT, весь код открыт до строчки — проверить всё это может каждый. С локальной моделью через Ollama ваши тексты вообще не покидают компьютер.

## Вопросы и ответы

<details>
<summary><strong>Textus бесплатный?</strong></summary>

Да. Textus бесплатен, его код открыт (лицензия MIT), аккаунт и подписка не нужны. За Textus AI вы платите своему провайдеру — или никому, если модель локальная.

</details>

<details>
<summary><strong>На каких платформах работает Textus?</strong></summary>

На macOS (Apple Silicon и Intel), Windows и Linux. Версии для iPhone и iPad в разработке.

</details>

<details>
<summary><strong>Нужен ли аккаунт для ИИ?</strong></summary>

Нет. Редактор полностью работает и без ИИ. Чтобы включить Textus AI, подключите провайдера: войдите через ChatGPT или Claude, вставьте API-ключ или запустите локальную модель через Ollama.

</details>

<details>
<summary><strong>Работает ли Textus без интернета?</strong></summary>

Редактор — полностью. Textus AI нужен доступ к провайдеру, если только модель не локальная: тогда ничего не покидает ваш компьютер.

</details>

<details>
<summary><strong>Это обычный Markdown? В какие форматы можно экспортировать?</strong></summary>

Да, это обычные файлы .md — с таблицами, списками задач, сносками, формулами и диаграммами Mermaid. Экспорт — в PDF, Word, HTML и другие форматы.

</details>

## Быстрый старт

1. Запустите Textus. Он открывается с пустым черновиком; файл понадобится только при сохранении.
2. Откройте **Настройки → Textus AI**, выберите провайдера и войдите или вставьте ключ в разделе **Вход и учётные данные**.
3. Начните писать. Когда вы остановитесь, продолжение появится серым; Tab принимает его.
4. Откройте Панель ИИ кнопкой **Textus AI** (перо) в строке окна. Остальное описано в **Справка → Руководство по ИИ**.

Все сочетания клавиш можно посмотреть и изменить в **Настройки → Сочетания клавиш**.

## Сообщество

- [Discord](https://textus.catvinci.com/discord): новости, помощь и отзывы, на английском.
- На китайском: [группа QQ](https://textus.catvinci.com/qq) (1128285004) · [группа WeChat](https://textus.catvinci.com/wechat)

Об ошибках и пожеланиях пишите в [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues).

## Планы и участие в разработке

Куда движется Textus, описано в [ROADMAP.md](ROADMAP.md) (на английском). Чтобы собрать Textus, запустить проверки или открыть pull request, начните с [CONTRIBUTING.md](CONTRIBUTING.md) (на английском); ИИ-ассистенты для программирования следуют [AGENTS.md](AGENTS.md). Обсуждение — на английском или китайском.

## История звёзд

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## Лицензия

[MIT](./LICENSE) © CatVinci Studio
