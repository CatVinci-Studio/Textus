---
name: translate
description: >-
  Translates a passage or document into another language and polishes it to read
  as native writing there: the target language's punctuation, number and date
  conventions, established names and terms, no translationese; also post-edits
  existing translations. Use when asked to translate or to fix a translation
  (翻译/译成, 翻訳, 번역, traducir, traduire, übersetzen, перевести, traduzir).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "revise"
  textus-packs: "contract"
  textus-target-packs: "typography numbers register"
  textus-sources: "Our own text. Name and term rules summarised from 외래어 표기법, 外来語の表記, GB/T 28039 and OpenCC phrase logic (Apache-2.0, ideas); translationese patterns from k-skill, im-not-ai and Humanizer-zh (MIT, ideas)."
  textus-aliases-en: "translate"
  textus-aliases-zh: "翻译润色, 翻译, 译成"
  textus-aliases-zh-Hant: "翻譯潤飾, 翻譯"
  textus-aliases-ja: "翻訳して整える, 翻訳"
  textus-aliases-ko: "번역"
  textus-aliases-es: "traducir"
  textus-aliases-fr: "traduire"
  textus-aliases-de: "übersetzen"
  textus-aliases-ru: "перевести"
  textus-aliases-pt: "traduzir"
---

# Translate and polish

## Scope
- The selection; else the passage the user names; else the whole document. Long documents: one section at a time, reading each section first.
- The target language comes from the request. If the conventions for the target language are not attached below, load them first with use_skill, for example use_skill("standards-ja#typography"); the packs are standards-en, standards-zh-hans, standards-zh-hant, standards-ja, standards-ko, standards-es, standards-fr, standards-de, standards-ru and standards-pt. If the target isn't clear, ask.

## Do
- Meaning first, then idiom: translate sentences, not words. Keep register and person, mapping politeness by relationship, not by form (敬語, 존댓말, vous, Sie).
- Convert conventions, never values: quotation marks (「」 for Japanese, « » for French, Russian, Spanish and European Portuguese, „“ for German), number and date formats (2026-10-14 → 2026年10月14日 / 14 October 2026 / 14.10.2026), decimal separators, spacing (French no-break spaces; no spaces between Japanese and Latin text). Units and amounts stay as given unless the user asks for conversion.
- Names: library entries and their aliases first, then established target-language forms (Korean loanword rules for Japanese names, Hanyu Pinyin for Chinese names in Latin script, katakana per 外来語の表記).
- Terms: give the source term in parentheses on first mention only when the target language has no established term; in Chinese publications, gloss necessary foreign words.
- Remove translationese: Chinese stacked 被, chains of 的, 进行 + verb; Japanese excess 彼/彼女 and needless katakana loanwords; Korean ~에 대해, ~를 통해, ~에 있어, 되어지다; English nominalisations.
- Simplified ↔ Traditional Chinese is localisation, not character conversion: phrase-level vocabulary (软件 → 軟體, 视频 → 影片/視訊), “” ↔ 「」, 〈〉 for article titles in Taiwan, the Taiwan interpunct ．; flag terms that need a human choice (质量 → 品質 only where it means quality). It changes script and regional vocabulary only: no cutting, rewording or tightening while converting.
- Keep Markdown structure, code, URLs, link targets and inline formatting exactly.

## Don't
- Translate quoted code, identifiers, or text the user marked to keep.
- Change figures, add explanations the source lacks, or drop sentences.

## Deliver
- Revise mode: replace the passage with the translation, one proposal per section. "Bilingual" or "keep the original": insert_after each paragraph instead.
- Write mode: insert_after each paragraph, as for "bilingual" - the original stays.
- Review mode: the translation in the reply.
- Reply in the user's language, not the target's: one sentence, plus at most three terms or names the user should check.
