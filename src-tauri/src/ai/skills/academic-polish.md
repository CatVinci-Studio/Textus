---
# The academic tells, claims and evidence, voice and venue, and grant-proposal
# sections are adapted from academic-humanizer
# (https://github.com/AIScientists-Dev/academic-humanizer), reworded and
# restructured; the Chinese section is new. academic-humanizer builds on
# "humanizer" by blader (https://github.com/blader/humanizer, MIT).
#
# Copyright (c) 2026 AIScientists-Dev
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify, merge,
# publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
# to whom the Software is furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all copies or
# substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
name: academic-polish
description: >-
  Polishes academic writing and grant proposals: formal, precise wording
  without boilerplate or over-claiming, each claim matched to its evidence,
  terms and units consistent; numbers, equations and citations stay as
  written. Use when asked to polish a paper, thesis, abstract or grant
  proposal or make it more academic (学术润色/论文润色, 基金申请书, 論文の推敲,
  논문 다듬기, estilo académico, style académique, wissenschaftlich, научный
  стиль).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "format"
  textus-packs: "contract standards#academic standards#numbers standards#ai-tells"
  textus-sources: "Our own text. Summarised from GB/T 7713.2-2022, GB/T 7714-2025, CY/T 174-2019, APA 7, MLA 9 and Chicago 18 (summarised only); BIPM SI Brochure (CC BY 4.0); hedging ideas from Kiterlin (MIT) and the Manchester Academic Phrasebank (category idea only); academic tells, claim-evidence and grant-proposal sections adapted from academic-humanizer (AIScientists-Dev, MIT), which builds on blader/humanizer (MIT); the Chinese section is ours."
  textus-aliases-en: "academic, paper, grant, proposal"
  textus-aliases-zh: "学术润色, 论文润色, 学术, 基金申请书, 国自然"
  textus-aliases-zh-Hant: "學術潤飾, 論文潤飾, 計畫書, 研究計畫書"
  textus-aliases-ja: "論文の推敲, 論文, 学術, 申請書, 科研費"
  textus-aliases-ko: "논문, 학술, 연구계획서"
  textus-aliases-es: "académico, propuesta, subvención"
  textus-aliases-fr: "académique, financement"
  textus-aliases-de: "wissenschaftlich, förderantrag"
  textus-aliases-ru: "научный, грант"
  textus-aliases-pt: "acadêmico, proposta"
---

# Academic polish

## Scope
- The selection; else the section the user names (abstract, method, literature review, Specific Aims, 立项依据); else the current section. Not the whole document unless asked.
- Papers, theses, rebuttals and grant proposals. Neutral, precise prose is the right voice: add no opinion, humour or personal colour.

## Keep exactly
- Every number, unit, result, equation, symbol, defined term, method and metric name, and every citation and cite key ([7], [@chen2021], \cite{…}, (Li 等，2023)). Reword around them; never change, drop, merge or reorder them.
- Evidence-tied hedges (suggests, is consistent with, we hypothesize, may indicate; 初步表明, 提示, 可能): never strengthen "suggest" into "show".
- Passive voice where the actor doesn't matter, "we", semicolons, an occasional list of three. Quotations.

## Do
- Formal, precise and plain: no colloquialisms (其实, 基本上, 大家都觉得; "a lot of", "pretty much"); one term per concept; abbreviations defined at first use.
- Calibrate claims to the design: association is not causation; survey data does not "prove"; one sample does not generalise to "every". One warranted hedge, never stacked hedges. State real limitations once, without reflexive modesty.
- Numbers and units: keep the form the document uses (12,400 stays 12,400, 30 公里 stays 30 公里). Apply the attached conventions (SI symbols, a space between number and unit, consistent decimals) only to a form that is inconsistent within the document, or when the user asks for formatting.
- Chinese: titles at most 25 characters with no hype; abstracts about 400/300/150 characters by type; 3–8 keywords. Reference lists follow GB/T 7714 only when the user asks for formatting.
- English: APA, MLA or Chicago basics per the attached conventions, only where the document already follows one or the user names it.

Fix these tells, using only what the text already says:
- Over-claiming verbs: prove, demonstrate, establish, confirm, guarantee; "significantly" with no test or number. Downgrade to what the evidence supports.
- Hype: paves the way, a crucial step toward, revolutionize, opens new avenues, sheds light on, of paramount importance, bridges the gap. Say what the work does.
- Empty intensifiers: extensive or comprehensive experiments, a wide range of, numerous, various. Use the count or names the text gives, else cut.
- Novelty padding: "novel" more than once a section, "to the best of our knowledge", "for the first time". State the difference from prior work instead.
- Formulaic openers: "In recent years, X has attracted increasing attention", "With the rapid development of", "Despite recent advances". Open with the problem.
- Moreover, Furthermore, Additionally starting consecutive sentences; boilerplate emphasis (It is worth noting that, Importantly, Notably).
- Contribution lists that restate the abstract: each item names its specific result, where the text gives it.
- Citation dumps ("Many methods exist [3, 7, 9, 12, 15]"): when the text says what a cited work does, name it and why it matters; otherwise keep the list and comment that it needs a sentence on the closest work.
- Vague hedges (somewhat, relatively, fairly, to some extent): the number the text gives, or cut.
- Sentences over about 30 words or with three or more stacked clauses: split, one idea each.
- The attached general tells (inflated significance, -ing tails, copula avoidance, delve, underscore, showcase), within the exceptions above.

## Claims and evidence
- Each empirical claim points to a number, figure, table or citation already in the document, and no verb is stronger than that evidence. A vague magnitude becomes the number or range the text gives, attributed to its metric and baseline; compare with the strongest baseline first.
- An unbacked claim: soften it, or keep it and comment asking for the evidence. Never add a number, result, citation or pointer (Table 2, Figure 3) the document doesn't have.

## Voice and venue
- Match the author: the rhythm, connectives, hedging and notation of the rest of the document and the style profile.
- Match the venue the user or document names: ML conferences terse and results-first, Nature or PNAS more expository.

## Grant proposals
A proposal sells vision and feasibility: keep ambition (long-term goal, transformative, pioneer) where the plan and evidence back it, and check each claim against feasibility instead of trimming it.
- Edit the opening hardest. By the end of page 1 (NIH Specific Aims) or pages 2–3 (NSF Project Description) the reader has the hook, the gap, the central idea, the aims and the payoff. NSF Project Summary: Overview, Intellectual Merit, Broader Impacts, each self-contained. NIH Aims: problem and gap; long-term goal and central hypothesis; "The objective of this application is…"; 2–3 aims (goal, approach, expected outcome); payoff.
- Fix: vague importance ("an important and timely problem") into the concrete cost of the gap; an aim that names a method ("Apply transfer learning") into the question or outcome; dominoed aims into independently valuable ones, or state the fallback; ambition without footing next to the preliminary data, prior result or collaborator the text names; a hedged central hypothesis into a falsifiable one (hedges belong in the approach). Comment on boilerplate broader impacts or training plans, asking for concrete programmes.
- Keep run-in lead-ins (**Goal:**, **Aim 1:**), a running example, aims posed as sharp questions, and the team's real track record placed early as evidence of feasibility.
- Never invent preliminary results, funding, partners or letters; comment on what is missing.

## Chinese
- 论文和基金申请书里常见的套话：随着…的快速发展、近年来…受到广泛关注式开头；没有内容支撑的“具有重要的理论意义和现实意义”“产生深远影响”；没有数据或检验的“显著提升”“大幅提高”；泛用的赋能、助力、抓手、打造；动词前层层加“进一步”；以“综上所述”“由此可见”开头却不推进论证的段落；卓有成效、日益凸显一类四字词堆砌；“的…的…的”过长定语（拆句，或把修饰成分移到后面）；机械的首先…其次…最后。
- 国自然申请书：立项依据从具体问题出发，讲清已知什么、缺口在哪里（附引用）、本项目如何填补，不写成综述；研究目标是可检验的目标，与研究内容和拟解决的关键科学问题一一对应，不喊口号；可行性分析引用团队自己的前期工作和数据，数字照原文。同样逐条核对“论断与可行性”。
- 保留有依据的“初步”“提示”“可能”和学科术语；中文标点按所附规范，破折号与一字线照常使用。

## Don't
- Invent or alter references, authors, years, page numbers, DOIs, data or quotations; add citations. Where a claim needs evidence, a citation or a scope limit, say so in a comment.
- Edit citations, figures or reference lists, except plain formatting the user asks for.
- Make the prose casual, or add opinion, anecdote or first-person colour.
- English only: no em dashes in your text; recast with commas, colons, parentheses or a new sentence.
- Rewrite paragraphs with no findings.
- Help hide AI use: this improves the writing and is not for evading an AI-use disclosure or detection; don't judge whether the text reads as human or AI.

## Deliver
- Write mode: one replace (all in the one propose_edit call) per paragraph that has findings (or per change, for a single fix), covering everything the original covered; one comment (all in one add_comment call) for each claim that needs evidence, a citation or a narrower scope, and for each reference you can't verify (mark it 【待核实】 in Chinese, "[check]" otherwise, in the comment, not in the text).
- Review mode or a check request: comments only, and the revised paragraphs in the reply when asked.
- Reply with a short change report: the kinds of tells removed, the claims softened or flagged, any voice or venue note, and that numbers, equations and citations are unchanged.
