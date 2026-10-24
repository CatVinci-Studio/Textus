---
name: de-ai
description: >-
  Finds and fixes wording that reads as machine-written (stock AI phrases,
  inflated significance, formulaic structure, chatbot residue) while keeping
  facts, hedges, quotations and the author's voice; reports without editing when
  asked only to check. Use when asked to remove AI tone or clichés or make text
  sound less AI-written (去AI味, AIっぽさ, AI 티, tono de IA, ton IA, KI-Ton,
  стиль ИИ).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "revise"
  textus-packs: "contract standards#ai-tells"
  textus-sources: "Our own text. Patterns summarised from Wikipedia 'Signs of AI writing' (CC BY-SA, summarised only), Kobak et al. 2025 (CC BY 4.0, word frequencies), blader/humanizer, avoid-ai-writing, Humanizer-zh, yomiyasu, k-skill, im-not-ai and Kiterlin (MIT, ideas), 科普中国 2025 (summarised). rnskill ra-人话 (CC BY-NC) ideas only, no text."
  textus-aliases-en: "ai-tone"
  textus-aliases-zh: "去AI味, AI味"
  textus-aliases-zh-Hant: "去AI味"
  textus-aliases-ja: "AIっぽさを消す, AIっぽさ"
  textus-aliases-ko: "AI티, AI 말투"
  textus-aliases-es: "tono-ia"
  textus-aliases-fr: "ton-ia"
  textus-aliases-de: "ki-ton"
  textus-aliases-ru: "без-ии"
  textus-aliases-pt: "tom-ia"
---

# Remove AI tone

## Scope
- The selection; else the passage the user names; else the current section, or the whole document when it is short.
- Two kinds of request: **check** ("where does it sound like AI", "先别改") gets comments only; **rewrite** gets edits.

## How to judge
- Strong tells justify an edit on one sighting; weak tells only when several cluster in one paragraph.
- Never enough on their own: perfect grammar, formal register, transition words, curly quotes, em dashes, "In summary". Wordiness is a clarity edit, not evidence.
- Use the attached AI-tells list for the document's language. Where no list is attached, look for the generic categories: chatbot residue and placeholders; "not X but Y" shells; inflated significance and legacy claims; promotional adjectives; vague attribution ("experts say"); reflexive groups of three; participle tails that editorialise; formulaic openers and "challenges and prospects" closers; mechanical first/second/finally scaffolding.
- Technical senses are fine (robust statistics, financial leverage). A "not X but Y" that corrects a real belief stays.

## Do
- Replace each tell with the plain, specific statement it stands for, using only facts already in the text.
- Keep warranted hedges (may, 初步, 可能, 提示) where the evidence calls for them; remove only stacked ones.
- Keep the author's register (Japanese 常体/敬体 as written), claims, emphasis and what each sentence does.
- Two passes at most; stop when no justified edit remains. If the result changes more than about 30% of the text, say so; ask before going past 50%.

## Don't
- Inject a fake human voice: no invented anecdotes, asides, staccato fragments, manufactured stakes or forced contrarianism.
- Ban dashes wholesale; keep functional ones.
- Touch quotations, dialogue, titles, or text that discusses a phrase.
- Remove a Korean comma after a connective ending; it is correct.
- Say whether a human or an AI wrote the text, or promise it will pass a detector.

## Deliver
- Check: one comment (in one add_comment call) per strong finding or per cluster of weak ones, naming the pattern and why it reads as formulaic.
- Rewrite (Write mode): one replace per paragraph that has findings; paragraphs without findings stay untouched.
- Reply: the kinds of patterns changed, any flagged item kept on purpose and why, at most two questions.
