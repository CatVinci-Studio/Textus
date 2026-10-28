---
name: standards-en
description: >-
  Writing conventions for English: punctuation and typography presets, numbers, word choice and spelling variety, register and inclusive language, dialogue, letters, academic citation styles, ad disclosure and AI tells.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Adapted from the Google developer documentation style guide and the Microsoft Writing Style Guide (CC BY 4.0, changes made) and GOV.UK guidance (OGL v3.0); summarised from the Federal Plain Language Guidelines, GPO Style Manual, AR 25-50, The Tongue and Quill, Strunk 1920 and FTC 16 CFR 255 (public domain), Chicago 18, AP, APA 7, MLA 9, the Oxford style guide, ASA/CAP and Wikipedia (summarised only); Kobak et al. 2025 (CC BY 4.0); blader/humanizer and avoid-ai-writing (MIT, ideas)."
---

## typography
- Serial comma per preset (yes: Google, Microsoft, GPO, Chicago, APA, MLA, 18F; no in a simple series: AP, Oxford); in Automatic only inconsistency is flagged; always use it where it prevents ambiguity. (M) [PU-01]
- One space after a sentence; `en-US/army` restores two (AR 25-50, 2024 revision). (M) [PU-02]
- No space before , . ; : ? ! (M) [PU-03]
- Dashes per preset: closed em (Google, Microsoft, Chicago, APA, MLA), spaced em (AP, 18F), spaced en and no em (Oxford); never `--` in prose; one style per document. (M) [PU-04]
- Ranges per preset: hyphen (Google, times included), en dash (Chicago, APA, Oxford; Microsoft for pages and tables), "to" (GOV.UK; Microsoft for times); never "from 10-20" or "between 10-20". (M) [PU-05]
- Straight or curly quotes, one style per document; straight always inside code. (M) [PU-06]
- No greengrocer's apostrophe: 1990s, PDFs (Chicago 18: A's for single capitals). (M) [PU-07]
- Possessive of names ending in s per preset (Charles's / Charles'), consistent. (M) [PU-08]
- "and", not "&", in running text and headings; keep & in names (AT&T). (M) [PU-09]
- No period or colon at the end of headings and titles. (M) [PU-10]
- [en-US] capital after a colon when a full sentence follows; [en-GB] usually lower case. (M) [PU-11]
- Compound modifiers: hyphenate before a noun (Chicago, AP), only for clarity (Google), only if confusing (GOV.UK); no hyphen after -ly adverbs (info only). (M/S) [PU-14]
- Scare quotes sparingly; ellipsis one style per document; editorial changes in quotes in square brackets. (M/S) [PU-15, PU-16]
- [en-GB/govuk] no semicolons, no italics (single quotes for document names), bold only for interface labels; re-evaluate, co-ordinate, co-operate; reuse, reopen, email. (M) [PU-17, PU-18]
- Negative numbers with a minus sign U+2212, as info only; U+2013 accepted in the GOV.UK preset. (M) [NU-06]
- Sentence case by default; title case per style (Chicago 18: prepositions of five or more letters capitalised; AP, APA: words of four or more letters; MLA: prepositions lower case); one case per heading level. (M) [CA-01–CA-03]
- No capitals for importance; Black and Indigenous capitalised, White per preset; internet, email, seasons lower case; webpage one word (GOV.UK). (M) [CA-04–CA-07]
- At most three heading levels, none skipped; numbered lists for sequences, bullets otherwise, at least two items; lead-in and list punctuation per preset; no "etc." closing a list. (M) [PL-05, LI-01–LI-05]
- Every image has alt text (empty for decorative ones), ≤ 155 characters, no "Image of", end punctuation. (M) [LI-05, LI-06]
- Abbreviations spelled out on first use unless widely known; no periods in acronyms; a/an by sound (an hour; a user; by pronunciation for acronyms). (M) [LI-07, LI-08]

## numbers
- Spell out per preset: zero–nine (Google, Microsoft); one–nine (AP, 18F, APA; GPO numerals from 10); one–ten (Oxford); up to one hundred and round numbers (Chicago); only "one" (GOV.UK). (M) [NU-01]
- Numerals for units, percentages, money, times, dates, versions, steps, pages and decimals. (M) [NU-02]
- No numeral at the start of a sentence, with the preset's exceptions (a year; GOV.UK dates and headings; list items). (M) [NU-03]
- Two numbers side by side: spell one out (twelve 30-minute sessions); if one item of a type needs a numeral, all of that type in the passage take numerals. (M) [NU-04, NU-16]
- Commas in numbers of four or more digits (Microsoft: from five digits for years, pixels, baud; none in page numbers or addresses); a leading zero (0.5). (M) [NU-05]
- Percent per preset: % (Google with no space, AP, APA, GOV.UK, Oxford) or "percent" (Microsoft prose, 18F, Chicago non-technical); GOV.UK spells "per cent". (M) [NU-07]
- [en-US] October 14, 2026, with a comma after the year mid-sentence; [en-GB] 14 October 2026; no ordinals in dates; ISO 8601 when an all-numeric date is unavoidable. (M) [NU-08–NU-10]
- Times per preset (3 PM; 5:00 PM; 10:30 a.m.; 5:30pm and midday; 11.30am); never "12 noon", "12 am", "12 pm"; one clock system per text. (M) [NU-11, NU-12]
- Money: symbol first; decimals only for cents or pence; million and billion in full (GOV.UK, Microsoft) or m and bn (Oxford). (M) [NU-13, NU-17]
- Ordinals per preset; never "firstly"; fractions per preset (two-thirds; decimals; whichever fits). (M) [NU-14, NU-15]

## words
- Short, familiar words (buy, help, about, use), suggestions from `en-plain-words.csv` (237 rows, public domain + CC0). (M) [WC-01]
- Wordy phrases: in order to → to; a number of → several; at this point in time → now; is able to → can; on a monthly basis → monthly; owing to the fact that → because; in the event of → if; prior to (flag only). (M) [WC-02]
- "the fact that", doublets (due and payable), excess modifiers (very, really, actually, totally), hidden verbs (conduct an analysis of): suggestions, never auto-deleted. (M) [WC-03–WC-06]
- must, not shall (off in legal presets); must/need/can; avoid "may be able to". (M) [WC-07]
- One term per concept in instructional, legal and technical text. (S) [WC-08]
- [en-GB/govuk] words to avoid, each with its "unless" exception kept in the list (deploy unless software, tackle unless rugby…): agenda, collaborate, deliver (abstract), empower, facilitate, focus, foster, impact, incentivise, key, leverage, liaise, overarching, progress, promote, robust, streamline, transform, utilise; drive out, going forward, in order to, one-stop shop, ring fencing. (M) [WC-09]
- Latin abbreviations: "for example", "that is"; no etc. after "for example"/"such as" ([apa] e.g. and i.e. only inside parentheses; [en-GB/oxford] eg and ie without stops). (M) [WC-10]
- No and/or, he/she, s/he, document(s). (M) [WC-11]
- In instructions: "please" only as info; no simple, easy, just, quickly; link text that names the destination, never "click here"; UI verbs per preset (select vs click), never "hit" or "click on"; "earlier"/"following" instead of above/below. (M) [WC-12–WC-16]
- Positive form, no double negatives; concrete words; noun strings of three or more nouns flagged. (M/S) [WC-17–WC-19]
- Misspellings and nonwords (alot, irregardless, could of, definately, seperate, recieve); doubled words as suggestions (had had and that that can be right); no tl;dr, ymmv or "10x" in formal text. (M) [WC-20–WC-22]
- "data is" in tech presets, "data are" in science presets, never flagged without a preset. Never flag split infinitives, "will" in the first person or "would" in conditionals. (guard) [Strunk 1920 overrides]
- One spelling variety per project: A (US), B (British -ise), Z (British -ize), C (Canadian), D (Australian), checked with ESDB/VarCon data. (M) [UK-01]
- [en-GB] -our, -re, -yse, licence/license, practice/practise, travelled, enrol, fulfil, programme (not software), grey, tyre, kerb, cheque, aluminium; American proper nouns keep their spelling (Pearl Harbor). (M) [UK-02]
- -ise in every variety (advertise, advise, comprise, compromise, devise, disguise, exercise, improvise, revise, supervise, surprise, tetextuse); -ize in every variety (capsize, prize, seize, size). (M) [UK-03]
- Vocabulary differences (flat/apartment, lift/elevator, autumn/fall) are flagged, never auto-converted. (S) [UK-04]
- [en-GB] single quotes first (Oxford) or GOV.UK's split (single for terms, double for speech); logical punctuation; Mr, Dr, St without stops; collective nouns may take plural verbs ([en-GB/oxford] singular). [en-US] double quotes; periods and commas inside except around literal strings in code font; Mr. and Dr. (M/S) [UK-05–UK-07]

## register
- One idea per sentence; hints above 25 words (info) and 40 (warning), 60 in fiction; paragraphs hinted above 150 words, warned above 250, off in fiction and academic presets. (M) [SP-01, SP-02]
- Active voice preferred (passive heuristic as info); instructions start with a verb; avoid It is / There is openers. (M) [VT-01, VT-02]
- Contractions per preset: common and especially negative (Google); common, not ambiguous (Microsoft); positive only, "cannot" (GOV.UK); none (academic, legal). (M) [VT-03]
- Friendly, not frivolous (Google); brisk but not terse, serious but not pompous (GOV.UK); no ALL CAPS runs; in non-fiction no "!!", "?!" or more than one "!" per paragraph. (S/M) [VT-04, VT-06, VT-07]
- Global English: no idioms or culture-bound references, explicit "that", unambiguous dates, units and time zones. (S) [VT-09]
- Inclusive language (advisory only inside dialogue, quotations and titles): singular they; chair, humanity, workforce; [en-GB] disabled people, [en-US] people with disabilities, never "suffers from" or "wheelchair-bound"; final check, placeholder instead of sanity check, dummy; older adults; allowlist and denylist, primary and replica; transgender as an adjective, trans woman; no "illegal" for people; traits mentioned only when relevant. (M/S) [IN-01–IN-12]

## dialogue
- [en-US] double quotes with the comma or period inside ("I'm going," she said.); [en-GB] single quotes with logical punctuation as a setting, though British fiction often keeps the comma inside; ? and ! inside only when they belong to the quote; a tag after a quoted ? or ! starts lower case ("Coming?" she asked). (M) [FI-01; Quotation marks in English (Wikipedia, summarised)]
- An action beat takes a period ("I'm going." She left.); interrupted speech closes the quote before the tag and reopens it; em dash for interruption, ellipsis for trailing off; a new paragraph per speaker; a quotation over several paragraphs opens each and closes only the last. (M/S) [FI-01, FI-02]

## letters
- [en-US] block format; "Dear Ms. Lee:" with "Sincerely,", only the first word of the closing capitalised. [en-GB] "Dear Ms Lee," with "Yours sincerely,"; "Dear Sir or Madam," with "Yours faithfully,"; prefer a name or role. (M) [EM-07, EM-08]
- Email structure: `craft#email`. [EM-01–EM-06, EM-09]

## academic
- [en-US/apa] (Author, Year); & in parentheses, "and" in the narrative; et al. from the first citation for three or more authors; page numbers for quotations; quotations of 40+ words as block quotes; references alphabetical with hanging indent, up to 20 authors, sentence-case titles, DOIs as https://doi.org/ links; heading levels L1–L5; e.g. and i.e. only in parentheses; abstract one paragraph, typically ≤ 250 words, 3–5 keywords. (M) [AC-01–AC-05; APA abstract guide, summarised]
- [en-US/mla] (Author page) with no comma or "p."; Works Cited core elements in order; italics for whole works, quotation marks for parts. (M) [AC-06]
- [en-US/general] Chicago 18: notes-bibliography or author-date per document; shortened notes instead of ibid.; bibliographies list up to six authors (more than six: first three + et al.). (M) [AC-07]
- Never invent citations, DOIs, pages or years; calibrate claims; one hedge per claim. (S) [Manchester Phrasebank (idea only); Humanizer-zh #9]

## social
- [en-US] disclosure with the endorsement, where it can't be missed ("ad", "sponsored", #ad optional); not only in a bio, at the end, behind "more" or among hashtags; never "sp", "spon", "collab", "thanks" or "ambassador" alone; spoken in video. (M flag) [FTC Disclosures 101; 16 CFR 255]
- [en-GB] a prominent "Ad" label upfront; #gifted, #aff or "affiliate" alone isn't enough; Instagram's Paid Partnership tag may do if upfront and prominent; on YouTube in the title or thumbnail. (M flag) [ASA/CAP, summarised]

## ai-tells
- Strong (edit on one sighting): chatbot residue and placeholders (Certainly!, I hope this helps, Let me know if…, [Your Name], 2025-XX-XX, INSERT_…); knowledge-cut-off disclaimers; "not X but Y" and "It's not X, it's Y" shells (keep when correcting a belief the reader holds); copula avoidance (serves as, stands as, boasts, features); inflated significance (a testament to, pivotal, underscores, marks a turning point); promotional words; vague attribution (experts say); "challenges and future prospects" closers; participle tails (", highlighting…").
- Weak (clusters only): Tier 1A words reviewed on each sighting and warned at two or more per paragraph (delve, tapestry, testament to, robust, leverage as a verb, pivotal, seamless), skipping technical senses; Tier 2 words (harness…) at two or more per paragraph; the dated lists (2023–mid-2024: additionally, boasts, crucial, delve, intricate, meticulously, pivotal, tapestry, testament, underscore, vibrant; mid-2024–mid-2025: align with, enhance, fostering, highlighting, showcasing; mid-2026 on: challenge, clearer, dependable, foster, leverage, multifaceted, practical, prioritize, quietly, steady, universally); reflexive triads; title case or decorative bold in a sentence-case document; inline-header lists; emoji bullets.
- Hard to read (edit when it slows the reader, in clusters or not): strings of three or more nouns (reader-patience budget); a dropped "that" before a relative clause where it shows the structure; a noun made a verb for the occasion (calendar it, footnote it); a thing doing what people do (the data asks us, a song invites you), unless the author means the figure; a subject far from its verb; word pairs no one says. Each is rewritten to the plain sentence it stands for. [Clark, Martin & Mahowald 2026, summarised]
- Never enough alone: em dashes (a historical indicator; above about 1 per 1,000 words is only a polish hint), curly quotes, perfect grammar, formal register, transition words, "In summary". Wordiness is a clarity edit, not evidence.
- Sources: [Wikipedia: Signs of AI writing (summarised); Kobak et al. 2025; blader/humanizer, avoid-ai-writing (MIT)]
