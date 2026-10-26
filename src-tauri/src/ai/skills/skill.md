---
name: skill
description: >-
  Makes a skill - reusable instructions the user calls with /name, or that the
  AI follows when a request matches - from the user's description of a task
  they do again and again, and writes it as one skill file in the reply, ready
  to save with one click and to change in the next message; never edits the
  document. Use when asked to make, write or change a skill, a saved procedure,
  a template for a recurring task or a /command (技能/做个技能, スキル, 스킬,
  habilidad, compétence, Fähigkeit, навык).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "create"
  textus-modes: "create"
  textus-packs: "contract"
  textus-sources: "Our own text; the file format is the Agent Skills format (agentskills.io), summarised."
  textus-aliases-en: "make-skill, procedure, command"
  textus-aliases-zh: "做技能, 技能, 新建技能"
  textus-aliases-zh-Hant: "做技能, 技能, 新增技能"
  textus-aliases-ja: "スキルを作る, スキル"
  textus-aliases-ko: "스킬 만들기, 스킬"
  textus-aliases-es: "habilidad, crear-habilidad"
  textus-aliases-fr: "compétence, créer-compétence"
  textus-aliases-de: "fähigkeit, skill"
  textus-aliases-ru: "навык, создать-навык"
  textus-aliases-pt: "habilidade, criar-habilidade"
---

# Make a skill

## Scope
- One skill for one kind of task the user does again and again (a weekly report, how their newsletter is translated, a review checklist). The skill goes in the reply, never into the document.
- When the request is too vague to write ("a skill for my work"), ask one question: what the task is and what a good result looks like. Otherwise write it and say what you assumed.
- Built from what the user said in this conversation: every requirement they gave, in order. Nothing about this document in particular - the skill must work on the next one.
- To change a skill from earlier in the conversation, write the whole file again with the change, keeping its `name` and raising `textus-version`.

## The file
One Markdown file: front matter, then the instructions.

```markdown weekly-report.md
---
name: weekly-report
description: >-
  Turns the week's notes into the team's weekly report: done, next, blocked,
  each point one line with its owner. Use when asked for a weekly report,
  status update or 周报.
metadata:
  textus-version: "1.0.0"
  textus-invocation: "both"
  textus-modes: "write"
  textus-label-zh: "写周报"
  textus-hint-zh: "把本周笔记整理成团队周报"
  textus-aliases-zh: "周报, 工作周报"
---

Turn the notes the user points to (the selection, or the document) into ...
```

- `name`: two to four English words in kebab-case, the file's name too (`weekly-report.md`).
- `description`: what it does, then "Use when ..." with the words people would ask with, in their language too. The AI picks the skill by this line, so make it specific.
- `textus-modes`: where the skill applies, one or more of `write` (it changes or adds text in the document), `review` (it only reads and comments), `create` (it makes a theme, plugin or skill). Most skills are `write`; a checking task is `review`.
- `textus-invocation`: `both` (the AI may pick it by itself), or `user-only` when it should run only when typed as /name.
- `textus-label-<code>` and `textus-hint-<code>`: the name and one-line hint people see, in the user's language, where `<code>` is one of en, zh, zh-Hant, ja, ko, es, fr, de, ru, pt; `textus-aliases-<code>`: other words they might type after /.

## The instructions
- Second person, to the AI: "Turn the notes into ...". Plain numbered steps for a procedure, bullets for rules.
- What to read (the selection, the document, a file in the project), what to produce, its form and length, and where it goes: proposed into the document in `write`, comments in `review`.
- The user's exact requirements, in their words where they gave them: terms, order, tone, format, what never to do.
- At most about 40 lines. No headings for a short skill.

## Do
- Keep what the user asked for and nothing else; leave out general writing advice the AI already follows.
- Write the instructions in the user's language when the task is in that language; otherwise in English.

## Don't
- Don't name the app, a model or a provider in the skill.
- Don't write a skill for a one-off request about this text - say it needs no skill and just do the task in Write mode.

## Deliver
- A one-line reply first: what the skill does and how to call it (/name).
- Then the file in one fenced code block whose info string is `markdown <name>.md`, front matter first. The chat shows Save this skill under it, where the user picks its modes.
- Nothing after the block but a short line on what they might change.
