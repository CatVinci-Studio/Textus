//! Everyday writing in Chinese and English - emails, reports, academic
//! paragraphs, technical docs with code, meeting notes, essays, fiction
//! with dialogue, social posts and product copy - asked casually and
//! formally, on short documents and on a 42k-character one, through the
//! side panel and through Quick Ask on a selection (the inline widget:
//! Revise mode, and every follow-up sent against the selection as it reads
//! after the accepted edits - see harness::UserTurn::follow_selection).

use super::agent_matrix::{
    edit_anywhere, edit_in, either, inserted, no_edit, proposed_text, with_cursor, AgentCase,
    Expect,
};
use super::checks::{self, Caret, Lang, StructureExpect};
use super::docs::*;
use super::harness::TurnOutcome;
use crate::ai::agent::AgentMode;

/// The edit lies strictly between two markers of the document before it
/// (both untouched) - for a passage that changes from turn to turn.
pub fn between(o: &TurnOutcome, start: &str, end: &str) -> Result<(), String> {
    if o.doc_after == o.doc_before {
        return Ok(());
    }
    let a = o
        .doc_before
        .find(start)
        .ok_or_else(|| format!("{start:?} is gone"))?
        + start.len();
    let b = o
        .doc_before
        .find(end)
        .ok_or_else(|| format!("{end:?} is gone"))?;
    let (s, e, _) = checks::changed_span(&o.doc_before, &o.doc_after);
    if s >= a && e <= b {
        Ok(())
    } else {
        Err(format!("changed bytes {s}..{e} outside {a}..{b}"))
    }
}

/// Quick Ask: the edit stays inside the selection the turn was sent with.
pub fn in_selection(o: &TurnOutcome) -> Result<(), String> {
    let Some((a, b)) = o.caret.selection else {
        return Err("no selection was sent".into());
    };
    if o.doc_after == o.doc_before {
        return Ok(());
    }
    let region = &o.doc_before[a..b];
    checks::check_region(&o.doc_before, &o.doc_after, region)
}

/// The quote marks of a passage survive a rewrite of its dialogue.
pub fn quotes_kept(o: &TurnOutcome, marks: &[char]) -> Result<(), String> {
    let count = |s: &str| s.chars().filter(|c| marks.contains(c)).count();
    let (before, after) = (count(&o.doc_before), count(&o.doc_after));
    (before == after)
        .then_some(())
        .ok_or_else(|| format!("{before} quote marks -> {after}"))
}

/// The dialogue survives a rewrite of its tags: the same words are spoken,
/// in the same order, in the same kind of quote marks. Counting marks
/// (`quotes_kept`) fails a correct edit when a tag that split one line of
/// speech goes - `"The bus broke down," he replied. "I ran the last mile."`
/// becomes a single quote (round-2 integration, `novel/en/beats`).
pub fn spoken_words_kept(o: &TurnOutcome, open: char, close: char) -> Result<(), String> {
    let spoken = |doc: &str| -> Vec<String> {
        let mut words = Vec::new();
        let mut inside = false;
        let mut current = String::new();
        for c in doc.chars() {
            if inside && c == close {
                inside = false;
                words.extend(
                    current
                        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
                        .filter(|w| !w.is_empty())
                        .map(str::to_lowercase),
                );
                current.clear();
            } else if !inside && c == open {
                inside = true;
            } else if inside {
                current.push(c);
            }
        }
        words
    };
    let marks = |doc: &str| -> Vec<char> {
        let mut m: Vec<char> = doc
            .chars()
            .filter(|c| ['"', '“', '”', '「', '」', '\u{2018}', '\u{2019}'].contains(c))
            .filter(|c| *c != '\u{2019}' || open == '\u{2018}')
            .collect();
        m.sort_unstable();
        m.dedup();
        m
    };
    let (before, after) = (spoken(&o.doc_before), spoken(&o.doc_after));
    if before != after {
        return Err(format!(
            "spoken words changed: {} -> {}",
            before.join(" "),
            after.join(" ")
        ));
    }
    let (kinds_before, kinds_after) = (marks(&o.doc_before), marks(&o.doc_after));
    (kinds_before == kinds_after)
        .then_some(())
        .ok_or_else(|| format!("quote marks {kinds_before:?} -> {kinds_after:?}"))
}

/// Digits the edit wrote that the document didn't have - an invented
/// figure (a reformatted one, "1,056" -> "1056", is allowed).
pub fn no_new_numbers(o: &TurnOutcome) -> Result<(), String> {
    let new = super::checks::new_numbers(&o.doc_before, &proposed_text(o));
    new.is_empty()
        .then_some(())
        .ok_or_else(|| format!("new numbers {new:?}"))
}

/// Lines of the proposed text that are list items.
pub fn list_items(text: &str) -> usize {
    text.lines()
        .filter(|l| {
            let t = l.trim_start();
            t.starts_with("* ") || t.starts_with("- ") || {
                let d = t.chars().take_while(char::is_ascii_digit).count();
                d > 0 && t[d..].starts_with(". ")
            }
        })
        .count()
}

/// A list the edit adds uses the editor's own bullet (`*`), so it reads
/// back as the document's list rather than a second one.
pub fn bullet_matches(o: &TurnOutcome) -> Result<(), String> {
    // Only next to an existing `*` item, where a `-` item starts a second
    // list; a list that replaces a paragraph is re-bulleted by the editor.
    let dashes = o
        .proposals
        .iter()
        .filter(|p| p.anchor.trim_start().starts_with("* "))
        .flat_map(|p| p.text.lines())
        .filter(|l| l.trim_start().starts_with("- "))
        .count();
    (dashes == 0)
        .then_some(())
        .ok_or_else(|| format!("{dashes} `- ` item(s) in a `*` document"))
}

fn has_any(text: &str, any: &[&str]) -> bool {
    any.iter().any(|a| text.contains(a))
}

pub fn cases() -> Vec<AgentCase> {
    let mut cases = zh_cases();
    cases.extend(en_cases());
    cases
}

fn zh_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // Email.
    let body = &EMAIL_ZH[EMAIL_ZH.find("王经理您好").unwrap()..];
    c.push(AgentCase::new("email/zh/formal", Lang::ZhHans, Lang::ZhHans, EMAIL_ZH, "请把这封邮件改得更正式、更得体一些，时间地点这些信息都不要动。", edit_in(body, StructureExpect::Any).has(&["24", "三楼会议室", "周四"]), "A formal request to polish a Chinese business email. Expect edits within the email body that raise the register (书面语, polite forms) while keeping every fact: 22 Oct meeting moved to 24 Oct (Fri) 10:00, same 3rd-floor room, agenda unchanged, document sent before Thursday close. Reply briefly in Chinese."));
    c.push(AgentCase::new("email/zh/casual-shorten", Lang::ZhHans, Lang::ZhHans, EMAIL_ZH, "第一段太啰嗦了，帮我砍短点", edit_in(para(EMAIL_ZH, 1), StructureExpect::Same).shorter().has(&["22", "24", "三楼"]), "Casual request: cut the long first paragraph. Expect one edit to that paragraph only, clearly shorter, still polite, keeping: original 22 Oct 2 p.m., reason (technical lead's trip to Shenzhen), proposed 24 Oct 10 a.m., same 3rd-floor room."));

    // Weekly report.
    c.push(AgentCase::new("report/zh/question", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "这周订单量比上周多了多少？", no_edit().reply(&["180"]), "A factual question about the table: 3,150 vs 2,970 orders, i.e. 180 more (about 6%). Expect no edit and a short Chinese answer."));
    let risks = checks::lines_between(WEEKLY_ZH, "* 第三方物流", "85%");
    c.push(AgentCase::new("report/zh/add-risk", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "风险里再加一条：供应商的发票系统下周升级，可能影响对账。", edit_in(&risks, StructureExpect::Delta(&[("item", 1), ("p", 0), ("/", 1)])).has(&["发票"]).check("new item uses the list's bullet", bullet_matches), "Expect one new bullet item appended to the 风险 list (same `*` bullet, same terse style), nothing else changed."));
    let mut review = no_edit().comments();
    review.reply_any.clear();
    c.push(AgentCase::new("report/zh/review", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "帮我挑挑这份周报的毛病，具体到哪一条。", review, "A review request: expect add_comment cards pinned to specific lines (e.g. the vague 风险 items with no owner or mitigation, the dashboards with no names, no explanation of the crash-rate drop), comments in Chinese, no edits."));

    // Academic.
    let lit = para(ACADEMIC_ZH, 0);
    c.push(AgentCase::new("academic/zh/tighten-citations", Lang::ZhHans, Lang::ZhHans, ACADEMIC_ZH, "压缩一下文献综述这一段，引用和数据一个都不能少。", edit_in(lit, StructureExpect::Same).shorter().has(&["2019", "2021", "2022", "王明", "陈静", "张伟", "2.3", "500"]).check("keeps 1,056", |o| has_any(&o.doc_after, &["1,056", "1056"]).then_some(()).ok_or_else(|| "1,056 lost".into())), "Expect the literature paragraph tightened (cut 其实/大家基本上/口语 filler), every citation (王明和李华 2019, 陈静 2021, 张伟 2022) and figure (12 communities, 1,056 residents, 500 m, 2.3 points, three times a week) kept."));
    c.push(AgentCase::new("academic/zh/register", Lang::ZhHans, Lang::ZhHans, ACADEMIC_ZH, "把文献综述这一段改成规范的学术写作语气，去掉口语化的表达。", edit_in(lit, StructureExpect::Same).lacks(&["大家基本上", "其实已经"]).check("no invented figures", no_new_numbers), "Expect the paragraph rewritten in academic Chinese (研究表明, 已有研究, 值得注意的是 ...), colloquialisms removed, citations and figures unchanged, no new claims."));

    // Technical doc with code.
    let code = checks::lines_between(TECH_ZH, "```python", "client.send(batch)\n```");
    c.push(AgentCase::new("tech/zh/translate-comments", Lang::ZhHans, Lang::ZhHans, TECH_ZH, "把代码里的英文注释翻译成中文，代码本身一个字符都别动。", edit_in(&code, StructureExpect::Same).check("code lines unchanged", |o| {
        let code_lines = |d: &str| -> Vec<String> {
            let a = d.find("```python").unwrap_or(0);
            let b = a + d[a..].find("\n```\n").unwrap_or(d.len() - a);
            d[a..b].lines().filter(|l| !l.trim_start().starts_with('#')).map(str::to_string).collect()
        };
        (code_lines(&o.doc_before) == code_lines(&o.doc_after)).then_some(()).ok_or_else(|| "a code line changed".into())
    }).check("comments are Chinese", |o| {
        let a = o.doc_after.find("```python").unwrap_or(0);
        let comments: String = o.doc_after[a..].lines().take(9).filter(|l| l.trim_start().starts_with('#')).collect();
        checks::check_lang(&comments, Lang::ZhHans)
    }), "Expect only the three # comments translated into natural Chinese inside the python block; every code line byte-identical, fence and language tag kept."));
    c.push(AgentCase::new(
        "tech/zh/question",
        Lang::ZhHans,
        Lang::ZhHans,
        TECH_ZH,
        "retry 默认重试几次？",
        no_edit().reply(&["3"]),
        "Expect no edit and a one-line Chinese answer: 3 times (默认 3).",
    ));

    // Meeting notes.
    let todo = checks::lines_between(MEETING_ZH, "* [ ] 张伟", "外包团队");
    c.push(AgentCase::new(
        "meeting/zh/check-task",
        Lang::ZhHans,
        Lang::ZhHans,
        MEETING_ZH,
        "张伟那条已经做完了，勾掉。",
        edit_in(
            &todo,
            StructureExpect::Delta(&[("task", -1), ("task:x", 1)]),
        )
        .has(&["* [x] 张伟"]),
        "Expect exactly that task item checked (`* [x] 张伟：...`), nothing else touched.",
    ));
    c.push(AgentCase::new("meeting/zh/summary", Lang::ZhHans, Lang::ZhHans, MEETING_ZH, "会上定了哪几件事？简单列一下。", no_edit().reply(&["10%"]), "An information request: expect the three decisions (homepage gray release Tuesday at 10%, membership price unchanged until year-end review, Android crash top priority) listed in the reply, in Chinese, no edit."));
    let quote_item = checks::lines_between(MEETING_ZH, "* [ ] 李娜", "更新报价单");
    c.push(AgentCase::new("meeting/zh/add-deadline", Lang::ZhHans, Lang::ZhHans, MEETING_ZH, "给“更新报价单”这一项加上截止时间：下周三。", edit_in(&quote_item, StructureExpect::Same).has(&["下周三", "更新报价单"]), "Expect only the 李娜 task line changed to carry the deadline (e.g. 李娜：下周三前更新报价单), still an unchecked task item."));

    // Essay.
    let p2 = para(ESSAY_ZH, 1);
    c.push(AgentCase::new("essay/zh/vivid", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "让第二段更有画面感一点，但别编造原来没有的情节。", edit_in(p2, StructureExpect::Same).check("no invented figures", no_new_numbers), "Expect the second paragraph made more vivid through sharper verbs and sensory wording of what is already there (stool at the door, cutting, fire, lifting the lid, the slow afternoon) - no new events, people or dishes. Reply in Chinese."));
    let ending = Expect {
        edit: super::agent_matrix::EditExpect::Required,
        ..Expect::default()
    }
    .check("added at the end", |o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        (s >= o.doc_before.find("后来外婆").unwrap_or(0))
            .then_some(())
            .ok_or_else(|| "not at the end".into())
    });
    c.push(AgentCase::new("essay/zh/continue", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "帮我续写一个结尾段落。", ending, "Expect one new closing paragraph at the end, in the essay's plain, restrained voice, building on what is there (the kitchen, the braised pork, grandmother moving away) without inventing dramatic events."));

    // Fiction with dialogue.
    let dialogue = &NOVEL_ZH
        [NOVEL_ZH.find("“你还没走").unwrap()..NOVEL_ZH.find("老周没再说话").unwrap()]
        .trim_end()
        .to_string();
    c.push(AgentCase::new("novel/zh/dialogue", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "让中间这两句对话更自然一点，引号格式别动。", edit_in(dialogue, StructureExpect::Same).check("quote marks kept", |o| quotes_kept(o, &['“', '”'])), "Expect the two dialogue paragraphs reworded to sound more natural and in character, still two paragraphs with Chinese curly quotes “ ”, the scene's facts unchanged."));
    let at = NOVEL_ZH.find("转身去烧水。").unwrap() + "转身去烧水。".len();
    let (message, caret) = with_cursor(NOVEL_ZH, at, "在这里加一句林晚的动作。");
    c.push(AgentCase::new("novel/zh/cursor-insert", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, &message, edit_anywhere().check("inserted at the cursor", move |o| {
        let p = o.proposals.first().ok_or("no proposal")?;
        if !(p.action == "insert_at_cursor" || p.action == "insert_after") {
            return Err(format!("used {}", p.action));
        }
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        (s >= at - 3 && s <= at + 3).then_some(()).ok_or_else(|| format!("inserted at byte {s}, cursor at {at}"))
    }), "Expect one short sentence describing an action of 林晚, inserted exactly at the cursor (after 老周 turns to boil water), consistent with the scene; reply in Chinese.").caret(caret));

    // Social post.
    c.push(AgentCase::new("social/zh/shorten-100", Lang::ZhHans, Lang::ZhHans, SOCIAL_ZH, "压缩到 100 字以内，发朋友圈用。", edit_in(para(SOCIAL_ZH, 0), StructureExpect::Same).check("at most 100 characters", |o| {
        let n = checks::word_count(&proposed_text(o));
        (n <= 100).then_some(()).ok_or_else(|| format!("{n} characters"))
    }), "Expect the post rewritten to at most 100 Chinese characters, keeping the highlights (千岛湖 with parents, crowds but great weather, mum's 200+ photos, the fish-head soup, bring grandma next time), casual tone."));

    // Product copy.
    c.push(AgentCase::new("product/zh/bullets", Lang::ZhHans, Lang::ZhHans, PRODUCT_ZH, "把卖点整理成三条，用列表。", edit_in(para(PRODUCT_ZH, 0), StructureExpect::Any).has(&["50"]).check("three list items", |o| {
        let n = list_items(&proposed_text(o));
        (n == 3).then_some(()).ok_or_else(|| format!("{n} items"))
    }).check("list uses the editor's bullet", bullet_matches), "Expect the paragraph replaced by a three-item list of selling points (light texture that absorbs fast and leaves no residue; soft tea scent; 50 ml lasts about two months), every fact kept, no invented claims."));

    // A 42k-character document: outline only, the target in chapter 7.
    let long = long_doc_zh();
    c.push(AgentCase::new("long/zh/edit-middle", Lang::ZhHans, Lang::ZhHans, &long, "把第七章第二段改得简洁一些，数字别丢。", edit_in(LONG_ZH_TARGET, StructureExpect::Same).shorter().has(&["214", "青石巷"]).tools(&[]).check("read before editing", |o| {
        o.tools.iter().any(|t| t == "read_document" || t == "search_document").then_some(()).ok_or_else(|| "edited without reading".into())
    }), "A 42k-character Chinese report shown only as an outline: expect read_document (or search) on chapter 7, then one edit to its second paragraph (the visit to 214 households in 青石巷 over three months, the two concerns: temporary housing and rent after renovation), clearly shorter, nothing else touched."));
    c.push(AgentCase::new("long/zh/question-middle", Lang::ZhHans, Lang::ZhHans, &long, "第七章里，试点一共走访了多少户居民？", no_edit().reply(&["214"]).check("read the section", |o| {
        o.tools.iter().any(|t| t == "read_document" || t == "search_document").then_some(()).ok_or_else(|| "answered without reading".into())
    }), "Expect the agent to read/search chapter 7 and answer: 214 households in 青石巷 (over about three months), in Chinese, no edit."));

    // A 28k-character document: whole until the limit counted Chinese as
    // three, now the outline and the section the cursor is in - nothing it
    // needs may go missing. The cursor is in chapter 7, as when the user
    // works there.
    let mid = mid_doc_zh();
    let ch7 = mid.find("## 第七章").expect("chapter 7") + 3;
    let at_ch7 = Caret {
        cursor: Some(ch7),
        selection: None,
    };
    c.push(AgentCase::new("long/zh/mid-edit", Lang::ZhHans, Lang::ZhHans, &mid, "把第七章第二段改得简洁一些，数字别丢。", edit_in(LONG_ZH_TARGET, StructureExpect::Same).shorter().has(&["214", "青石巷"]).tools(&[]), "A 28k-character Chinese report, cursor in chapter 7: one edit to chapter 7's second paragraph (214 households in 青石巷 over three months, the two concerns: temporary housing and rent after renovation), clearly shorter, nothing else touched.").caret(at_ch7));
    c.push(AgentCase::new("long/zh/mid-question", Lang::ZhHans, Lang::ZhHans, &mid, "第七章里，试点一共走访了多少户居民？", no_edit().reply(&["214"]), "Expect the answer from chapter 7: 214 households in 青石巷 (over about three months), in Chinese, no edit."));
    c.push(AgentCase::new("long/zh/mid-question-elsewhere", Lang::ZhHans, Lang::ZhHans, &mid, "第七章第二段提到的两个主要问题是什么？", no_edit().reply(&["安置", "房租"]), "The cursor isn't in chapter 7 (the section shown is the document's start): expect the agent to read or search chapter 7 and name the two concerns - temporary housing during renovation and rent rising afterwards - in Chinese, no edit."));

    // Quick Ask on a selection (the inline widget).
    c.push(AgentCase::new("quick/zh/selection-shorten", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "缩短一点", edit_anywhere().shorter().check("edit inside the selection", in_selection), "Quick Ask on the selected second paragraph: expect one replace_selection (or an equivalent replace) shortening exactly the selection, the voice kept, nothing outside it touched.").quick(p2));
    let p1 = para(EMAIL_ZH, 1);
    let keep = |o: &TurnOutcome| -> Result<(), String> {
        (o.doc_after.contains("24") && o.doc_after.contains("三楼"))
            .then_some(())
            .ok_or_else(|| "lost the new date or the room".into())
    };
    c.push(
        AgentCase::new("quick/zh/five-turn", Lang::ZhHans, Lang::ZhHans, EMAIL_ZH, "改简洁一点", edit_anywhere().shorter().check("edit inside the selection", in_selection).check("facts kept", keep), "Five Quick Ask turns on the same selected paragraph, every edit accepted, each follow-up sent against the paragraph as the previous edit left it: (1) shorter; (2) more formal; (3) dates in the form 10 月 24 日（星期五）; (4) split the last sentence in two; (5) a check for typos that should leave a clean paragraph alone (or fix only a real typo). Every edit stays inside the paragraph and keeps 22 Oct, 24 Oct 10 a.m., the 3rd-floor room; replies in Chinese.")
            .quick(p1)
            .then(true, "语气再正式一些", edit_anywhere().check("edit inside the selection", in_selection).check("facts kept", keep))
            .then(true, "日期都写成“10 月 24 日（星期五）”这种格式", edit_anywhere().has(&["星期五"]).check("edit inside the selection", in_selection).check("facts kept", keep))
            .then(true, "最后一句太长了，拆成两句", edit_anywhere().check("edit inside the selection", in_selection).check("facts kept", keep))
            .then(true, "好，帮我看看这段还有没有错别字，没有就不用改", either().check("edit inside the selection", in_selection).check("facts kept", keep)),
    );

    // The side panel's default mode is Ask: an edit request there can't
    // produce a proposal (no propose_edit tool) - the reply has to cope.
    c.push(AgentCase::new("panel/zh/review-mode-edit-request", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "把第二段改短一点", no_edit(), "The panel is in Review mode (its default) and has no edit tool. Good: a shortened version offered in the reply and/or a note that switching to Revise mode lets it change the document; in Chinese; no false claim that the document was changed.").mode(AgentMode::Review));

    // Cross-language and open questions.
    c.push(AgentCase::new("cross/zh-asks-en-email/polite", Lang::ZhHans, Lang::En, EMAIL_EN, "帮我把这封邮件的语气改得更客气一些。", edit_anywhere().has(&["1,200", "700", "500", "14 October"]), "The user writes in Chinese about an English email: edits stay English (warmer, more apologetic), every fact kept (PO 4471, 1,200 units, 700 on 30 Sept, 500 by 14 Oct, $380 freight); the reply is Chinese."));
    c.push(AgentCase::new("ambiguous/zh/how-is-it", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "你觉得这篇怎么样？", no_edit(), "An opinion question: expect specific, honest feedback in Chinese (strong concrete details; the ending is abrupt; maybe one suggestion), no edit."));
    c
}

fn en_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // Email.
    let body = &EMAIL_EN[EMAIL_EN.find("Hi Daniel").unwrap()..];
    c.push(AgentCase::new("email/en/formal", Lang::En, Lang::En, EMAIL_EN, "Please make this email more formal.", edit_in(body, StructureExpect::Any).has(&["4471", "1,200", "700", "500", "14 October", "380"]), "Expect the email body raised to a formal register (no contractions or casual phrasing), every fact kept: PO 4471 of 2 Sept, 1,200 units, supplier delay, 700 on 30 Sept and 500 by 14 Oct, ~$380 freight covered. Brief English reply."));
    c.push(AgentCase::new("email/en/casual-shorten", Lang::En, Lang::En, EMAIL_EN, "can u make the first para shorter? it rambles", edit_in(para(EMAIL_EN, 1), StructureExpect::Same).shorter().has(&["30 September", "1,200"]), "Casual phrasing with abbreviations: expect the first body paragraph (Thanks for your patience...) clearly shorter, keeping PO 4471/2 Sept, the supplier delay and that 1,200 units won't ship on 30 Sept."));
    c.push(AgentCase::new(
        "email/en/question",
        Lang::En,
        Lang::En,
        EMAIL_EN,
        "When did I originally promise the delivery?",
        no_edit().reply(&["30 September", "30 Sept"]),
        "Expect no edit; a one-line answer: 30 September (for the full 1,200 units).",
    ));

    // Report with a table.
    let summary = para(SUPPORT_EN, 0);
    c.push(AgentCase::new("report/en/fix-total", Lang::En, Lang::En, SUPPORT_EN, "The total in the summary doesn't match the table. Fix the summary.", edit_in(summary, StructureExpect::Same).has(&["2,300"]).lacks(&["2,310"]), "The table's totals add up to 2,300 (1,185 + 780 + 335), the summary says 2,310. Expect only that number in the summary changed to 2,300; the reply explains the arithmetic briefly."));
    let table = checks::lines_between(SUPPORT_EN, "| Channel", "| Phone");
    c.push(AgentCase::new("report/en/add-row", Lang::En, Lang::En, SUPPORT_EN, "Add a row for Social: 40 in July, 55 in August, 70 in September.", edit_in(&table, StructureExpect::Delta(&[("tr", 1), ("td", 5), ("/", 6)])).check("row reads Social 40 55 70 165", |o| checks::row_cells_are(&o.doc_after, "Social", &["Social", "40", "55", "70", "165"])), "Expect one new table row Social | 40 | 55 | 70 | 165 (the total computed), in the table's format, nothing else changed (the summary's ticket total may be left alone or flagged in the reply, not silently changed)."));

    // Academic.
    let lit = para(ACADEMIC_EN, 0);
    c.push(AgentCase::new("academic/en/tighten", Lang::En, Lang::En, ACADEMIC_EN, "Tighten the literature paragraph. Keep every citation and number.", edit_in(lit, StructureExpect::Same).shorter().has(&["Bloom", "2015", "13%", "Gibbs", "2023", "Emanuel", "2024", "2020"]), "Expect the paragraph tightened (cut 'to put it mildly', 'It is basically clear', 'a lot'), all three citations and the figures (13%, 2020) kept, academic register."));
    let method = para(ACADEMIC_EN, 1);
    c.push(AgentCase::new("academic/en/hedge", Lang::En, Lang::En, ACADEMIC_EN, "Tone down the claims in the Method section - we only have cross-sectional survey data.", edit_in(method, StructureExpect::Same).lacks(&["causes higher", "prove that"]).has(&["412"]), "Expect the overclaiming sentence rewritten with appropriate hedging (associated with, suggest, for the firms surveyed), 412 employees and three firms kept, no new findings."));

    // Technical doc with code.
    let code = checks::lines_between(TECH_EN, "```js", "}\n```");
    c.push(AgentCase::new("tech/en/fix-await", Lang::En, Lang::En, TECH_EN, "uploadAll returns before the uploads are done. Fix it.", edit_in(&code, StructureExpect::Same).has(&["await client.upload"]), "The bug: client.upload(...) is not awaited inside the loop. Expect a minimal fix (await client.upload(...), or Promise.all) inside the js block, nothing else changed; the reply names the cause in a sentence."));
    let steps = checks::lines_between(TECH_EN, "1. Create", "target folder.");
    c.push(AgentCase::new("tech/en/add-step", Lang::En, Lang::En, TECH_EN, "Add a step between 2 and 3: set the TEXTUS_TOKEN environment variable to your token.", edit_in(&steps, StructureExpect::Delta(&[("item", 1), ("/", 1)])).has(&["TEXTUS_TOKEN"]), "Expect a new ordered item between steps 2 and 3 (renumbered 3/4 or left for Markdown to number), with `TEXTUS_TOKEN` in code formatting, nothing else changed."));
    // para() splits on blank lines, which the code block above has.
    let retries = checks::lines_between(TECH_EN, "Uploads that fail", "after each attempt.");
    c.push(AgentCase::new("tech/en/rewrite-keep-code", Lang::En, Lang::En, TECH_EN, "Rewrite the Retries paragraph so it's easier to scan.", edit_in(&retries, StructureExpect::Any).keep_inline().has(&["`retries`", "`backoffMs`"]), "Expect the Retries paragraph made scannable (shorter sentences or a short list), keeping the inline code `retries`, `3` and `backoffMs` and every fact (automatic retry on network errors, default 3, delay doubles)."));

    // Meeting notes.
    let actions = checks::lines_between(MEETING_EN, "* Jonas to write", "next week");
    c.push(AgentCase::new("meeting/en/to-tasks", Lang::En, Lang::En, MEETING_EN, "Turn the action items into a checklist.", edit_in(&actions, StructureExpect::Delta(&[("task", 3)])).has(&["[ ] Jonas"]), "Expect the three action items turned into unchecked task items (`* [ ] ...`), wording unchanged, nothing else touched."));
    c.push(AgentCase::new("meeting/en/recap", Lang::En, Lang::En, MEETING_EN, "quick recap of what we decided?", no_edit().reply(&["1.4"]), "Expect the three decisions summarised in the reply (offline mode behind a flag in 1.4; drop the Windows 7 installer; price stays $8/month until January), no edit."));
    let at = MEETING_EN.len();
    let (message, caret) = with_cursor(
        MEETING_EN,
        at,
        "Add another open question here: whether teams need SSO.",
    );
    c.push(AgentCase::new("meeting/en/cursor-insert", Lang::En, Lang::En, MEETING_EN, &message, edit_anywhere().has(&["SSO"]).check("added after the last question", |o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        (s >= o.doc_before.find("Do we need").unwrap_or(0)).then_some(()).ok_or_else(|| "not at the cursor".into())
    }), "Cursor at the end of the Open questions section: expect one new question about SSO for teams added there (its own line or paragraph, matching the existing question's style).").caret(caret));

    // Essay.
    let p1 = para(ESSAY_EN, 0);
    c.push(AgentCase::new("essay/en/vivid", Lang::En, Lang::En, ESSAY_EN, "Make the opening paragraph more vivid, but don't invent anything.", edit_in(p1, StructureExpect::Same).check("no invented figures", no_new_numbers).has(&["Mr. Hale"]), "Expect the first paragraph made more vivid through sharper wording of what is there (narrow shop, creaky floor, kettle on a hot plate, Saturday mornings, age eleven) - no new events, smells or people the author didn't mention."));
    c.push(AgentCase::new("essay/en/cliches", Lang::En, Lang::En, ESSAY_EN, "Cut the clichés.", edit_anywhere().lacks(&["At the end of the day", "times have changed", "nothing lasts forever"]), "Expect the clichés (a very special place that meant a lot; at the end of the day; times have changed; nothing lasts forever) cut or replaced with plain, specific wording, everything else intact."));

    // Fiction with dialogue.
    let dialogue = &NOVEL_EN[NOVEL_EN.find("\"You're late").unwrap()..];
    c.push(AgentCase::new("novel/en/beats", Lang::En, Lang::En, NOVEL_EN, "Replace the adverb dialogue tags with action beats.", edit_in(dialogue, StructureExpect::Same).check("dialogue kept", |o| spoken_words_kept(o, '"', '"')).lacks(&["said angrily", "replied apologetically", "said coldly", "said sheepishly"]), "Expect each 'said angrily/replied apologetically/said coldly/said sheepishly' replaced by a short action beat that shows the emotion, the spoken words unchanged, no new plot."));
    let end = Expect {
        edit: super::agent_matrix::EditExpect::Required,
        ..Expect::default()
    }
    .check("dialogue added at the end", |o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        let added = inserted(o);
        let quotes = added.matches('"').count() + added.matches('“').count();
        (s >= o.doc_before.find("He held up").unwrap_or(0) && quotes >= 6)
            .then_some(())
            .ok_or_else(|| format!("{quotes} quote marks added after byte {s}"))
    });
    c.push(AgentCase::new("novel/en/continue", Lang::En, Lang::En, NOVEL_EN, "Continue the scene with three more lines of dialogue.", end, "Fiction: inventing is fine here. Expect three more lines of dialogue appended after the last paragraph, consistent with Elena's irritation and Tom's dead phone, in the same past-tense style and quote marks."));

    // Social post.
    c.push(AgentCase::new("social/en/tweet", Lang::En, Lang::En, SOCIAL_EN, "Make this fit in a single tweet (280 characters).", edit_in(para(SOCIAL_EN, 0), StructureExpect::Same).has(&["textus.app"]).check("at most 280 characters", |o| {
        let n = proposed_text(o).trim().chars().count();
        (n <= 280).then_some(()).ok_or_else(|| format!("{n} characters"))
    }), "Expect the post cut to at most 280 characters, keeping the launch of Textus 1.0, the core pitch (offline, sync, AI that respects your writing), the thanks if room allows, free on macOS/Windows/Linux and textus.app."));

    // Product copy.
    c.push(AgentCase::new("product/en/bullets", Lang::En, Lang::En, PRODUCT_EN, "Turn the selling points into a 3-bullet list.", edit_in(para(PRODUCT_EN, 0), StructureExpect::Any).has(&["12%"]).check("three list items", |o| {
        let n = list_items(&proposed_text(o));
        (n == 3).then_some(()).ok_or_else(|| format!("{n} items"))
    }).check("list uses the editor's bullet", bullet_matches), "Expect a three-item list (learns your schedule in about a week; works with most systems, installs in ~30 minutes; the app shows savings, customers cut bills 12% the first winter), facts kept, no new claims."));

    // Quick Ask on a selection.
    let sentence = para(EMAIL_EN, 3);
    c.push(AgentCase::new("quick/en/selection-formal", Lang::En, Lang::En, EMAIL_EN, "make this more formal", edit_anywhere().check("edit inside the selection", in_selection), "Quick Ask on the selected closing line: expect it rewritten formally (replace_selection), meaning kept (does this work; offer of a call this week), nothing else touched.").quick(sentence));

    // Five turns in the side panel on the same paragraph (no selection).
    let span = |o: &TurnOutcome| between(o, "Hi Daniel,", "What we can do");
    c.push(
        AgentCase::new("panel/en/five-turn", Lang::En, Lang::En, EMAIL_EN, "Tighten the first paragraph after the greeting.", edit_anywhere().shorter().check("edit stays in the paragraph", span), "Five panel turns on the same paragraph, each edit accepted: (1) tighten; (2) warmer, Daniel is a long-time client; (3) add to the first paragraph that we've found a second supplier for future orders; (4) cut it to three sentences; (5) a question - does it still mention the original ship date? - answered without editing. Every edit stays in that paragraph and keeps PO 4471 and 1,200 units / 30 September.")
            .then(true, "Good. Now make it warmer - Daniel has been a client for years.", edit_anywhere().check("edit stays in the paragraph", span))
            .then(true, "Add to the first paragraph that we've already lined up a second supplier for future orders.", edit_anywhere().has(&["second supplier"]).check("edit stays in the paragraph", span))
            .then(true, "That's too long now. Cut it to three sentences.", edit_anywhere().check("edit stays in the paragraph", span).check("three sentences", |o| {
                let p = o.doc_after.split("\n\n").nth(2).unwrap_or("");
                let n = checks::sentences(p).len();
                (n <= 3).then_some(()).ok_or_else(|| format!("{n} sentences"))
            }))
            .then(true, "Perfect. Does it still mention the original ship date?", no_edit().reply(&["30 September", "30 Sept", "yes", "Yes", "no", "No"])),
    );
    c.push(AgentCase::new("panel/en/review-mode-edit-request", Lang::En, Lang::En, ESSAY_EN, "Tighten the second paragraph.", no_edit(), "The panel is in Review mode (its default) and has no edit tool. Good: a tightened version offered in the reply and/or a pointer to Revise mode; no claim that the document changed.").mode(AgentMode::Review));

    // Cross-language and review.
    c.push(AgentCase::new("cross/en-asks-zh-novel/question", Lang::En, Lang::ZhHans, NOVEL_ZH, "What is Lin Wan waiting for?", no_edit().reply(&["rain"]), "The user writes in English about a Chinese chapter: expect an English answer (she is waiting for the rain to ease), no edit."));
    let mut review = either();
    review.edit = super::agent_matrix::EditExpect::Forbidden;
    c.push(AgentCase::new("review/en/email-before-send", Lang::En, Lang::En, EMAIL_EN, "Anything I should fix before I send this?", review, "A question asking for feedback: expect specific points (e.g. the long first paragraph, 'like we originally promised you we would', maybe confirming the freight amount), as comments or in the reply, and no edit."));
    c.push(AgentCase::new("ambiguous/en/thoughts", Lang::En, Lang::En, ESSAY_EN, "thoughts?", no_edit(), "A vague opinion request: expect brief, specific feedback (strong details; the clichés in paragraphs 2 and 3; the ending) and perhaps an offer to revise, no edit."));
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::live_eval::checks::{Caret, Proposal};

    fn outcome(before: &str, after: &str, text: &str) -> TurnOutcome {
        TurnOutcome {
            doc_before: before.into(),
            doc_after: after.into(),
            proposals: vec![Proposal {
                action: "replace".into(),
                anchor: "x".into(),
                text: text.into(),
                context: String::new(),
            }],
            ..TurnOutcome::default()
        }
    }

    #[test]
    fn helpers_judge_what_the_edit_did() {
        let before = "# T\n\nWe surveyed 1,056 people in 12 towns.\n\nEnd.";
        let ok = outcome(before, before, "We surveyed 1056 people in twelve towns.");
        assert!(no_new_numbers(&ok).is_ok());
        let bad = outcome(before, before, "We surveyed 1,056 people in 13 towns.");
        assert!(no_new_numbers(&bad).unwrap_err().contains("13"));
        assert_eq!(list_items("* a\n* b\n- c\n1. d\ntext"), 4);
        let after = before.replace("12 towns", "twelve towns");
        let o = outcome(before, &after, "");
        assert!(between(&o, "# T", "End.").is_ok());
        assert!(between(&o, "# T", "1,056").is_err());
        let mut q = outcome(before, &after, "");
        let s = before.find("We surveyed").unwrap();
        let e = before.find("\n\nEnd").unwrap();
        q.caret = Caret {
            cursor: None,
            selection: Some((s, e)),
        };
        assert!(in_selection(&q).is_ok());
        q.caret.selection = Some((before.find("End").unwrap(), before.len()));
        assert!(in_selection(&q).is_err());
        let next_to_item = |text: &str| {
            let mut o = outcome(before, before, text);
            o.proposals[0].anchor = "* an existing item".into();
            o
        };
        assert!(bullet_matches(&next_to_item("* one\n* two")).is_ok());
        assert!(bullet_matches(&next_to_item("- one")).is_err());
        // A list replacing a paragraph: the editor re-bullets it anyway.
        assert!(bullet_matches(&outcome(before, before, "- one")).is_ok());
    }

    #[test]
    fn dialogue_survives_a_tag_that_split_a_line_going() {
        let before = "\"You're late,\" she said angrily.\n\n\"The bus broke down,\" he replied apologetically. \"I ran the last mile.\"";
        // run3: the tag between the two halves went, so the halves joined.
        let joined = "Elena folded her arms. \"You're late.\"\n\nTom winced. \"The bus broke down. I ran the last mile.\"";
        assert!(spoken_words_kept(&outcome(before, joined, ""), '"', '"').is_ok());
        assert!(quotes_kept(&outcome(before, joined, ""), &['"']).is_err());
        let reworded = joined.replace("ran the last mile", "walked");
        let err = spoken_words_kept(&outcome(before, &reworded, ""), '"', '"').unwrap_err();
        assert!(err.contains("spoken words changed"), "{err}");
        // The same words in other quote marks: the house style changed.
        let curly = format!("{joined}\n\nShe sighed. “Fine.”");
        let mut o = outcome(&format!("{before}\n\nShe sighed. \"Fine.\""), &curly, "");
        o.doc_before = o.doc_before.replace("\"Fine.\"", "Fine.");
        let err = spoken_words_kept(&o, '"', '"').unwrap_err();
        assert!(err.contains("quote marks"), "{err}");
    }

    #[test]
    fn the_long_chinese_document_is_just_past_the_embedding_limit() {
        let doc = long_doc_zh();
        let n = doc.chars().count();
        assert!((40_000..46_000).contains(&n), "{n} chars");
        assert_eq!(doc.matches(LONG_ZH_TARGET).count(), 1);
        let ch7 = doc.find("## 第七章").unwrap();
        assert!(doc.find(LONG_ZH_TARGET).unwrap() > ch7);
    }
}
