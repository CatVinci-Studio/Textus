---
name: minutes
description: >-
  Turns meeting notes or a transcript into minutes that record decisions, action
  items with owners and due dates, and open questions, without inventing owners
  or dates, in the language's usual format (会议纪要, 議事録, 회의록). Use when
  asked to write up minutes, a meeting summary or action items from notes
  (纪要/会议记录, 議事録, 회의록, acta, compte rendu, Protokoll, протокол).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "format"
  textus-packs: "contract standards#official"
  textus-sources: "Our own text. 'A record of what was done and not what was said' from Robert's Rules of Order (1876, public domain); 纪要 phrasing from 党政机关公文处理工作条例 (2012)."
  textus-aliases-en: "minutes, action-items"
  textus-aliases-zh: "会议纪要, 纪要, 会议记录"
  textus-aliases-zh-Hant: "會議紀錄, 紀錄"
  textus-aliases-ja: "議事録"
  textus-aliases-ko: "회의록"
  textus-aliases-es: "acta"
  textus-aliases-fr: "compte-rendu, procès-verbal"
  textus-aliases-de: "protokoll"
  textus-aliases-ru: "протокол"
  textus-aliases-pt: "ata"
---

# Meeting minutes

## Scope
- The notes or transcript in the selection, the named passage, or the document.

## Do
- Record what was decided and what happens next, not who said what.
- Header with only the fields the notes give: meeting, date, time, place, chair, note-taker, attendees, absentees.
- Sections: Decisions; Action items; Open questions; Next meeting (leave out a section the notes give nothing for). Points the notes record that are neither decided nor assigned - feedback, findings, concerns - go in a short Discussion section before Decisions, never under Decisions.
- Notes that already have these sections still get what minutes lack: the header and an owner and due date (or TBD) on every action item.
- Action items as task-list items (`* [ ] owner – task – due date`). When the notes name no owner or date, write it so: "Owner: TBD" / 负责人待定 / 担当未定 / 담당자 미정, "due: TBD".
- Keep figures, versions and names exactly as in the notes.
- Chinese 纪要: 会议认为 / 会议指出 / 会议决定 / 会议要求; 出席： / 列席： / 请假： lines.
- Japanese 議事録: 日時・場所・出席者・議題・決定事項・宿題（担当・期限）・次回.
- Korean 회의록: 일시·장소·참석자·안건·결정 사항·후속 조치(담당·기한).
- Write in the language of the notes unless the user asks otherwise.

## Don't
- Invent owners, dates, decisions or attendees.
- Record a hypothesis or an opinion ("Sam thinks it's the token refresh") as a decision; it is an open question or a note.
- Turn an unresolved question ("launch next month?") into a decision.

## Deliver
- Revise mode: one proposal that replaces the notes with the minutes, or appends them below if the user wants the notes kept.
- Write mode: one proposal that appends the minutes below the notes.
- Review mode: the minutes in the reply.
- Reply in one or two sentences: the number of decisions and action items, and any owner or date still missing.
