---
name: imitate-style
description: >-
  Rewrites or writes text in the style of a sample, a style the user names, or
  the project's style profile, keeping the meaning and facts of the original and
  never copying the sample's sentences. Use when asked to write like a sample or
  an author, match a voice, or rewrite in this style (模仿文风/仿写, 文体をまねる,
  문체 모방, imitar el estilo, pastiche, im Stil von, стилизация).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "write"
  textus-packs: "contract"
  textus-sources: "Our own text. Content invariants adapted from yomiyasu (MIT, ideas); 'a sample overrides generic rules' from blader/humanizer (MIT, ideas)."
  textus-aliases-en: "style, pastiche"
  textus-aliases-zh: "模仿文风, 仿写, 文风"
  textus-aliases-zh-Hant: "模仿文風, 仿寫"
  textus-aliases-ja: "文体をまねる, 文体模写"
  textus-aliases-ko: "문체 모방"
  textus-aliases-es: "imitar"
  textus-aliases-fr: "pastiche"
  textus-aliases-de: "stil"
  textus-aliases-ru: "стилизация"
  textus-aliases-pt: "imitar"
---

# Imitate a style

## Scope
- The passage to rewrite (selection, named passage, or current section), or the new text the user asks for.
- The style source, in this order: a sample in this request (pasted, attached, or a project file the request names, read with read_file); a style the user names; the project's style profile.

## Do
- Infer a compact style sheet from the sample without writing it out: sentence length and its spread, paragraphing, register and grammatical person, tense, punctuation habits, imagery and vocabulary level, dialogue habits, rhythm devices.
- Keep the target's content: its claims, facts, numbers, sequence, how strongly each thing is asserted, and what each sentence does (fact, opinion, request, hypothesis, quotation).
- Treat concrete limits in the style profile (sentence length, banned words or punctuation) as rules; apply its habits where they read naturally. A sample given for this request beats the profile.
- Grammatical person and tense follow the style source, with one exception: the author's own first-person account of what they did ("I", "we") stays first-person and keeps its tense - turned into "you", it would say the reader did it. Imitate its rhythm, word choice and punctuation instead.
- Check the result against every concrete limit before proposing; fix a breach instead of reporting it in the reply.
- The writing instructions still win on language, terms and spellings.

## Don't
- Take sentences, distinctive phrases, names or events from the sample. Imitate how it writes, not what it says.
- Reproduce a named living author's text or present the result as theirs; approximate general traits only.
- Use an imitation to pass off a message as written by a real person.

## Deliver
- Revise mode: replace the target passage, one proposal per paragraph for long passages; or insert the new text.
- Write mode: insert the new text; a rewrite of a passage needs Revise mode.
- Review mode: the rewritten text in the reply.
- Reply with the two or three style traits you applied (for example "short declaratives, present tense, no semicolons"). If the user wants this style for every request, mention Learn my style from samples… in the project menu.
