---
name: summarize
description: >-
  Summarises a document or passage faithfully and in proportion, at the requested
  length or form (TL;DR, key points, abstract, executive summary, recap of
  decisions), keeping figures exact and adding nothing; answers in the reply
  unless asked to put the summary in the document. Use when asked to summarise,
  condense into key points or write an abstract (总结/摘要/概括, 要約, 요약,
  resumir, résumer, zusammenfassen, кратко изложить).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "user-only"
  textus-category: "format"
  textus-modes: "write"
  textus-packs: "contract standards#academic"
  textus-sources: "Our own text. BLUF from AR 25-50 (public domain); GOV.UK summaries (OGL v3.0); abstract conventions summarised from the APA abstract guide and GB/T 7713.2."
  textus-aliases-en: "summary, tldr, abstract"
  textus-aliases-zh: "总结摘要, 总结, 摘要, 概括"
  textus-aliases-zh-Hant: "摘要, 總結, 概述"
  textus-aliases-ja: "要約, まとめ, 要旨"
  textus-aliases-ko: "요약, 정리"
  textus-aliases-es: "resumir, resumen"
  textus-aliases-fr: "résumer, résumé"
  textus-aliases-de: "zusammenfassen, zusammenfassung"
  textus-aliases-ru: "резюме, конспект"
  textus-aliases-pt: "resumir, resumo"
---

# Summarize

## Scope
- The selection; else the passage or section the user names; else the whole document.

## Do
- Faithful: every figure exact and attributed as in the source; no evaluation the source doesn't make; keep the source's hedges.
- In proportion: weight follows importance, not position in the text.
- Forms:
  - TL;DR: one to three sentences.
  - Key points: three to seven bullets.
  - GOV.UK-style summary: at most 160 characters, ending with a full stop.
  - Executive summary: the bottom line first, then the decisions needed.
  - Abstract: APA style is one paragraph, typically at most 250 words, with 3–5 keywords when asked; Chinese abstracts about 400/300/150 characters by type, 3–8 keywords, no figure or reference numbers, abbreviations defined.
- Match the length the user asks for. "In N lines" (3行で, 三句话, 3 líneas) means N sentences, one per line, each carrying one point. When a limit is given, count with measure_text (`chars`, `cjk_chars` or `words`) instead of estimating.
- Write in the user's language when answering in the reply, and in the document's language when inserting into it.

## Don't
- Add outside knowledge, opinions or recommendations the source doesn't make.
- Quote loosely: keep quotations as quotations, or don't use them.

## Deliver
- By default, the summary in the reply, with no edit.
- When the user asks for the summary in the document: insert_after the H1, or insert it before the first section.
