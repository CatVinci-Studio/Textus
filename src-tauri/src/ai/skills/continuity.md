---
name: continuity
description: >-
  Checks a chapter or scene for continuity against the library and other
  chapters in the project folder: names and spellings, ages and looks,
  relationships, timeline, places, the state of objects, and what each
  point-of-view character can know; reports each conflict as a comment. Use when
  asked to check consistency, continuity or contradictions in fiction (前后矛盾/设定一致,
  整合性, 설정 오류, continuidad, cohérence, Kontinuität, нестыковки).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "check"
  textus-modes: "review"
  textus-packs: "contract craft#fiction"
  textus-sources: "Our own text."
  textus-aliases-en: "consistency"
  textus-aliases-zh: "检查前后一致, 设定检查, 前后矛盾"
  textus-aliases-zh-Hant: "檢查前後一致, 設定檢查"
  textus-aliases-ja: "設定の整合性チェック, 整合性"
  textus-aliases-ko: "설정 확인"
  textus-aliases-es: "continuidad"
  textus-aliases-fr: "cohérence"
  textus-aliases-de: "widersprüche"
  textus-aliases-ru: "нестыковки"
  textus-aliases-pt: "continuidade"
---

# Check continuity

## Scope
- The selection, chapter or scene the user names; else the current document.
- Sources of truth: the library entries sent with the request, the current document, and with a project folder, other chapters.

## Steps
1. Run check_conventions on the scope for near-miss spellings of library names and aliases (its library findings).
2. With a project folder: search_files for each main character or place named in the scope (at most five searches), and read_file for at most three of the hits. Without one, compare with the library and the current document only.
3. Compare the facts below and note every conflict with where the other version is.

## Do
Compare these facts:
- Names, aliases and their spellings.
- Ages and birthdays; appearance, scars and injuries.
- Relationships, titles and how characters address each other.
- Places, layouts, distances and travel times.
- Day and night, weather, season and the order of events.
- Objects: who has what, where it is, whether it is broken, lost or used up.
- Knowledge: a point-of-view character can't know what they haven't witnessed or been told.
- Lower priority, listed last: tense slips and point-of-view slips.

## Don't
- Edit the text. Fix conflicts only if the user asks afterwards.
- Report a deliberate change the story explains (a character dyes their hair, and the text says so). Report a change with no cause as "check", not as an error.
- Invent a fact to compare against; the library describes the canonical state.

## Deliver
- One comment per conflict (all in one add_comment call), pinned to the passage, naming the library entry or the file and passage where the other version is.
- Reply: a count by kind and the most serious conflict, with no rewriting advice unless asked.
