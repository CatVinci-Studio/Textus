---
name: continue-story
description: >-
  Writes the next scene or section of a story, novel or script, picking up exactly
  where the text stops, in the author's voice and consistent with the library and
  earlier chapters. Use when asked to continue the story, write the next part or
  chapter, or what happens next (续写/接着写, 続きを書く, 이어서 쓰기, continuar,
  continuer, weiterschreiben, продолжить). Not for non-fiction drafts or for
  questions about inline completion.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "write"
  textus-packs: "contract craft#fiction standards#dialogue standards#ai-tells"
  textus-sources: "Our own text. Ideas from chinese-novelist-skill (MIT) and mattpocock/skills writing-beats (MIT); show vs tell summarised from Wikipedia."
  textus-aliases-en: "continue, next-scene"
  textus-aliases-zh: "接着写, 续写, 写下一节, 下一章"
  textus-aliases-zh-Hant: "接著寫, 續寫, 寫下一節"
  textus-aliases-ja: "続きを書く, 続き"
  textus-aliases-ko: "이어서 쓰기, 다음 이야기"
  textus-aliases-es: "continuar"
  textus-aliases-fr: "continuer, suite"
  textus-aliases-de: "fortsetzen, weiterschreiben"
  textus-aliases-ru: "продолжить"
  textus-aliases-pt: "continuar"
---

# Continue the story

## Scope
- Continue from where the text stops, or from the cursor when the request carries one, or from the point the user names ("after the fight").
- Read the current section in full before writing, and the end of the previous one if the scene began there. With a project folder, search other chapters only for a name or event the request mentions that the document doesn't explain, at most twice.

## Do
- Write one section: about 400–800 words, or 600–1,200 Chinese or Japanese characters, unless the user gives a length. Start a new chapter only when asked, with a heading in the document's own chapter style.
- Pick up the exact moment: no recap, no restating the last line, no time skip unless the text was heading there.
- Keep the point of view and tense of the scene. The point-of-view character knows only what they have seen or been told.
- Let something move: a decision, a discovery, a reversal or rising tension. End on a natural pause, or on a hook if the section closes a chapter.
- Render key moments through action, dialogue and concrete sensory detail; use summary for transitions and passing time.
- New detail must agree with the text and the library: names, ages, looks, relationships, places, who knows what.
- Write dialogue in the attached conventions and the quotation style the document already uses. Keep paired …… and —— (or …… and ―― in Japanese) where the language uses them.

## Don't
- Introduce a major character, kill one, or resolve the central conflict unless asked.
- Explain the characters' feelings to the reader after showing them, or end on a moral.
- Use the patterns in the attached AI-tells list.

## Options instead of text
- If the user asks for directions or options, write no section: offer two or three candidate next beats of one or two sentences each, all consistent with the text, and wait for a choice.

## Deliver
- Write or Revise mode: one proposal that inserts the section after the last paragraph of the scene (insert_after), or at the cursor (insert_at_cursor) when the message carries one.
- Review mode: the new section in the reply, and a note that Write mode can insert it.
- Reply in one or two sentences saying what happens in the new section.
