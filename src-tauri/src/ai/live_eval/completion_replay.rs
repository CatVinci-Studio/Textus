//! The completion as a writer meets it: whole documents replayed as they
//! are typed, a completion asked for at each natural pause - a sentence
//! just finished, a clause after a comma, an empty new paragraph - with
//! exactly what the editor sends there (ghost-text-plugin.ts: the text
//! before the caret, nothing after it, the title, "short"). Each
//! suggestion is put beside what the writer actually wrote next, and Opus
//! says what a writer would do with it: take it (Tab), take its first
//! words (Ctrl/Cmd+Right), or ignore it - and why.
//!
//! The app asks only at "word" pauses - mid-clause, after a letter
//! (ghost-text-plugin.ts) - where suggestions were useful seven times in
//! ten; the other kinds are measured to see what they would be.
//!
//! The other completion suites ask whether one suggestion is well made;
//! this one asks how often a suggestion is worth having, how long it takes
//! to come, and what goes wrong when it isn't - the measure to tune the
//! prompt, the length and the trigger against.
//!
//!   cargo test --lib live_eval::completion_replay -- --ignored --nocapture
//! Knobs: TEXTUS_EVAL_FILTER (document ids), TEXTUS_EVAL_WRITING_MODEL,
//! TEXTUS_REPLAY_EXTRA (text appended to the instructions, to try a change
//! without editing the prompt), TEXTUS_REPLAY_LENGTH (short | long),
//! TEXTUS_EVAL_OUT (where replay.jsonl goes).

use super::completion_matrix::shown;
use super::harness;
use crate::ai::client::{completion_prompt, finish_suggestion, CompletionHints};
use serde_json::{json, Value};

pub struct Doc {
    pub id: &'static str,
    pub ui: &'static str,
    pub title: &'static str,
    /// Paragraphs separated by a blank line, as completionContext joins
    /// blocks.
    pub text: &'static str,
}

pub fn docs() -> Vec<Doc> {
    vec![
        Doc {
            id: "zh/email",
            ui: "zh",
            title: "关于中期报告延期的申请",
            text: "张老师您好：\n\n我是课题组的李然。原定下周五提交的中期报告，我这边可能需要延期一周。主要原因是第二批问卷的回收比预期慢，目前只收回了 120 份，离计划的 200 份还差不少。\n\n我已经联系了合作学校的两位老师，请他们在班会上再提醒一次学生填写。如果顺利的话，周三之前应该能收齐。数据收齐以后，我需要两三天做清洗和初步分析，所以想把提交时间改到下下周一。\n\n如果您觉得延期不合适，我也可以先用现有的 120 份数据写一个初稿，后面再补充。麻烦您抽空回复一下，看哪种方式更好。\n\n谢谢老师！",
        },
        Doc {
            id: "zh/essay",
            ui: "zh",
            title: "跑步这一年",
            text: "去年三月，我第一次下楼跑步，跑了不到一公里就停下来喘气。那时候我只是想减掉一点体重，没想到会坚持这么久。\n\n最开始的一个月最难。每天早上闹钟一响，我都要和自己讨价还价，告诉自己今天先跑十分钟就好。后来我发现，只要真的出了门，十分钟往往会变成二十分钟。\n\n真正让我坚持下来的，是小区里一位六十多岁的阿姨。她每天六点准时出现在操场，跑得不快，但从来不停。有一次我问她跑了多少年，她笑着说，记不清了，反正比你的年纪还长。\n\n现在我每周跑三次，每次五公里左右。体重确实轻了一些，但我更在意的是，早上跑完步的那种清醒感，好像一整天都有了底气。",
        },
        Doc {
            id: "zh/report",
            ui: "zh",
            title: "九月线上活动复盘",
            text: "本次活动从 9 月 12 日持续到 9 月 25 日，共带来新注册用户 3,400 人，比上一次活动多了约 40%。但付费转化率只有 2.1%，低于我们设定的 3% 目标。\n\n从渠道来看，短视频带来的用户最多，但留存最差，七日留存只有 18%。公众号推文带来的用户虽然少，七日留存却达到了 35%，付费意愿也明显更高。\n\n我们认为转化率偏低的主要原因有两个。一是活动页面的优惠信息放得太靠下，很多用户没有看到就离开了。二是新用户第一次打开应用时，引导流程太长，有将近一半的人在第三步就退出了。\n\n下一次活动，我们计划把预算更多地放到公众号和社群渠道，同时把引导流程缩短到两步以内。",
        },
        Doc {
            id: "zh/story",
            ui: "zh",
            title: "旧书店",
            text: "巷子尽头那家旧书店，开了快三十年。店主姓周，大家都叫他老周。店里没有空调，夏天只有一台老风扇，吱呀吱呀地转着。\n\n那天下午下着小雨，我进去躲雨，顺手翻了翻门口的一摞旧杂志。老周从柜台后面抬起头，看了我一眼，又低下头去修他那本散了线的字典。\n\n我在最里面的书架上找到一本旧诗集，扉页上有一行钢笔字，写着“给阿梅，一九八七年冬”。字迹很工整，墨水已经有点发黄了。我拿着书走到柜台，问老周这本多少钱。\n\n他接过书，翻到扉页，看了很久，才说，这本不卖。",
        },
        Doc {
            id: "en/email",
            ui: "en",
            title: "Leak in the bathroom ceiling",
            text: "Hi Mark,\n\nI wanted to let you know about a leak in the bathroom ceiling. It started on Sunday evening, after the people upstairs had a shower, and there is now a brown stain about the size of a dinner plate above the bath.\n\nI've put a bucket under it for now, and it only drips when the flat above uses water. I'm worried that if it goes on much longer the plaster will start to come down.\n\nCould you send someone to take a look this week? I work from home on Tuesdays and Thursdays, so either of those days would be easiest for me. If neither works, let me know and I can leave a key with the neighbour.\n\nThanks,\nSarah",
        },
        Doc {
            id: "en/blog",
            ui: "en",
            title: "Learning to cook without recipes",
            text: "For years I cooked the same way I assembled furniture: one step at a time, eyes on the instructions, never quite sure why anything worked. If a recipe called for shallots and I only had an onion, dinner was in trouble.\n\nThat changed last winter, when my sister stayed with us for a month. She never measures anything. She tastes as she goes, adds a little salt, a squeeze of lemon, and tastes again. When I asked how she knew when it was right, she shrugged and said it tasted finished.\n\nI started small. Instead of following a soup recipe exactly, I made it twice and changed one thing the second time. Then I tried roasting vegetables at different temperatures to see what happened. Most of it was fine, and a few things were much better than the recipe.\n\nI still use recipes, but now I read them the way you read directions from a friend: useful, but not the only way to get there.",
        },
        Doc {
            id: "en/academic",
            ui: "en",
            title: "Sleep and exam performance in first-year students",
            text: "We recruited 212 first-year undergraduates from two introductory courses. Participants wore a wrist actigraph for the two weeks before their final exams and completed a short sleep diary each morning.\n\nAverage sleep duration fell from 7.1 hours in the first week to 6.4 hours in the week of the exams. The drop was largest among students who reported studying after midnight, and smallest among those who kept a regular bedtime.\n\nShorter sleep in the exam week was associated with lower exam scores, even after controlling for prior grades. However, the association was weaker for students whose sleep was short but regular, which suggests that consistency may matter as much as duration.\n\nThese findings have practical implications for how universities schedule exams and advise students during revision periods.",
        },
        Doc {
            id: "en/notes",
            ui: "en",
            title: "Design review: onboarding flow",
            text: "We reviewed the new onboarding flow with the support team on Wednesday. Overall they liked the shorter sign-up form, but they raised two concerns.\n\nFirst, the new flow skips the step where users choose their workspace name. Support says this is the question they get most often in the first week, so removing it may just move the problem elsewhere.\n\nSecond, the progress bar suggests there are five steps when there are only three. Several people in the session found this confusing and assumed the app was broken when it finished early.\n\nWe agreed to keep the workspace step, but make it optional, and to fix the progress bar before the beta. Priya will update the designs by Friday.",
        },
    ]
}

/// Where a pause falls: after a full stop ("sentence"), a clause mark
/// ("clause"), or at the start of an empty new paragraph ("paragraph").
pub struct Pause {
    pub kind: &'static str,
    /// Byte offset of the caret in `text`.
    pub at: usize,
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ff00}'..='\u{ffef}')
}

/// The pauses in a text: every sentence end, every other clause mark,
/// every paragraph start but the first, and now and then mid-clause after
/// a word, skipping the first 15 characters (nothing to go on yet).
pub fn pauses(text: &str) -> Vec<Pause> {
    let mut out = Vec::new();
    let mut clauses = 0;
    let mut words = 0;
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (i, &(at, c)) in chars.iter().enumerate() {
        let end = at + c.len_utf8();
        let next = chars.get(i + 1).map(|&(_, n)| n);
        if text[..end].chars().count() < 15 {
            continue;
        }
        let at_break = next.is_none() || next == Some('\n');
        if c == '\n' && next == Some('\n') {
            // The caret in the next, still empty paragraph.
            out.push(Pause {
                kind: "paragraph",
                at: end + 1,
            });
            continue;
        }
        if at_break {
            continue;
        }
        let sentence =
            matches!(c, '。' | '！' | '？') || (matches!(c, '.' | '!' | '?') && next == Some(' '));
        let clause = matches!(c, '，' | '；') || (matches!(c, ',' | ';') && next == Some(' '));
        // Mid-clause, after a word: in English after the space between two
        // words, in Chinese now and then in running text - where a writer
        // stops to think, not only at punctuation.
        let word = (c == ' '
            && next.is_some_and(char::is_alphabetic)
            && text[..at].ends_with(char::is_alphabetic))
            || (is_cjk(c)
                && !matches!(c, '，' | '。' | '；' | '！' | '？' | '：' | '、')
                && next.is_some_and(is_cjk));
        if word {
            words += 1;
        }
        if sentence {
            out.push(Pause {
                kind: "sentence",
                at: end,
            });
        } else if clause {
            clauses += 1;
            if clauses % 2 == 1 {
                out.push(Pause {
                    kind: "clause",
                    at: end,
                });
            }
        } else if word && words % if is_cjk(c) { 9 } else { 7 } == 0 {
            out.push(Pause {
                kind: "word",
                at: end,
            });
        }
    }
    out
}

/// What the writer wrote next: up to the end of the next sentence (and at
/// least 25 characters), within the paragraph.
fn actual_next(text: &str, at: usize) -> String {
    let rest = &text[at..];
    let rest = rest.split("\n\n").next().unwrap_or("");
    let mut out = String::new();
    for c in rest.chars() {
        out.push(c);
        let n = out.chars().count();
        if n >= 25 && matches!(c, '。' | '！' | '？' | '.' | '!' | '?') {
            break;
        }
        if n >= 160 {
            break;
        }
    }
    out
}

/// ghost-text-plugin.ts's MAX_CONTEXT_CHARS.
const CONTEXT_CHARS: usize = 1500;

const JUDGE: &str = "You judge the inline autocomplete of a writing app as the writer would meet it. The writer is typing the document shown; they paused, and grey text appeared at the caret. You see the text before the caret, the grey suggestion, and what the writer actually went on to write.

Decide what this writer would most plausibly do:
- \"accept\": press Tab and keep it, as is or with a trivial touch - it says what they meant to say next, or something just as good that they would happily use.
- \"partial\": take the first words of it (Ctrl+Right, word by word) and then type their own - the opening is right, the rest isn't.
- \"reject\": ignore it and keep typing.

Judge usefulness to this writer, not word-for-word agreement: a different continuation can be accepted if it fits what the text sets up and the writer's voice. But the actual continuation shows where the writer was going; a suggestion that heads somewhere else, invents a fact the writer would have to delete (a number, a name, a date, a finding), restates what is already written, is generic filler, is in the wrong register or language, or is far too long or too short to be worth reading, is rejected.

Respond with ONLY a JSON object, no fences: {\"verdict\": \"accept\"|\"partial\"|\"reject\", \"kept\": <for partial: how many leading characters they'd keep, else 0 or the whole length>, \"flags\": [any of \"invents\", \"wrong_direction\", \"generic\", \"restates\", \"too_long\", \"too_short\", \"wrong_register\", \"wrong_language\", \"breaks_sentence\", \"empty\"], \"reason\": \"one short sentence\"}";

fn judge(
    auth: &aicompat::providers::anthropic::AnthropicAuth,
    before: &str,
    suggestion: &str,
    actual: &str,
) -> Value {
    let tail: String = {
        let chars: Vec<char> = before.chars().collect();
        chars[chars.len().saturating_sub(900)..].iter().collect()
    };
    let user = format!(
        "<text-before-caret>\n{tail}\n</text-before-caret>\n\n<suggestion>{suggestion}</suggestion>\n\n<what-the-writer-wrote-next>{actual}</what-the-writer-wrote-next>"
    );
    for _ in 0..2 {
        let Ok(reply) = harness::complete(auth, JUDGE, &user, Some(&harness::judge_model())) else {
            continue;
        };
        let raw = reply.text;
        let (Some(a), Some(b)) = (raw.find('{'), raw.rfind('}')) else {
            continue;
        };
        if let Ok(v) = serde_json::from_str::<Value>(&raw[a..=b]) {
            return v;
        }
    }
    json!({"verdict": "unjudged"})
}

struct Sample {
    doc: &'static str,
    kind: &'static str,
    before: String,
    suggestion: String,
    actual: String,
    ms: u128,
    verdict: Value,
}

/// The last `n` characters of `text`, as ghost-text-plugin's
/// completionContext cuts the before-text.
fn last_chars(text: &str, n: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    chars[chars.len().saturating_sub(n)..].iter().collect()
}

fn percentile(sorted: &[u128], p: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

#[test]
#[ignore = "live API - see module docs"]
fn live_completion_replay() {
    let Some(auth) = harness::auth() else {
        eprintln!("live_eval: no ANTHROPIC_API_KEY - skipping");
        return;
    };
    let model = harness::writing_model();
    let extra = std::env::var("TEXTUS_REPLAY_EXTRA").unwrap_or_default();
    let length = std::env::var("TEXTUS_REPLAY_LENGTH").unwrap_or_else(|_| "short".into());
    let mut jobs = Vec::new();
    for doc in docs().into_iter().filter(|d| harness::selected(d.id)) {
        for pause in pauses(doc.text) {
            jobs.push((doc.id, doc.ui, doc.title, doc.text, pause));
        }
    }
    let samples: Vec<Sample> = harness::par_map(&jobs, |(id, ui, title, text, pause)| {
        let before = last_chars(&text[..pause.at], CONTEXT_CHARS);
        let actual = actual_next(text, pause.at);
        let hints = CompletionHints {
            title: Some(title.to_string()),
            block: Some("paragraph".into()),
            length: Some(length.clone()),
            prose: Some(before.clone()),
            ui_language: Some(ui.to_string()),
            ..Default::default()
        };
        let (raw, ms) = {
            let (mut instructions, user_text) = completion_prompt(&before, "", &hints, None);
            if !extra.is_empty() {
                instructions.push_str("\n\n");
                instructions.push_str(&extra);
            }
            match harness::complete(
                &auth,
                &instructions,
                &user_text,
                harness::writing_model_arg(&model),
            ) {
                Ok(r) => (r.text, r.ms),
                Err(e) => (format!("<error {e}>"), 0),
            }
        };
        let suggestion = shown(&before, &finish_suggestion(&before, "", &raw, &hints));
        let verdict = if suggestion.trim().is_empty() {
            json!({"verdict": "empty", "flags": ["empty"]})
        } else {
            judge(&auth, &before, &suggestion, &actual)
        };
        Sample {
            doc: id,
            kind: pause.kind,
            before,
            suggestion,
            actual,
            ms,
            verdict,
        }
    });

    // Every sample, in full, for reading through.
    let dir = std::env::var("TEXTUS_EVAL_OUT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("textus-replay"));
    std::fs::create_dir_all(&dir).ok();
    let mut lines = String::new();
    for s in &samples {
        let tail: String = {
            let c: Vec<char> = s.before.chars().collect();
            c[c.len().saturating_sub(60)..].iter().collect()
        };
        lines.push_str(&json!({"doc": s.doc, "kind": s.kind, "before_tail": tail, "suggestion": s.suggestion, "actual": s.actual, "ms": s.ms, "verdict": s.verdict}).to_string());
        lines.push('\n');
    }
    let file = dir.join(format!("replay-{}.jsonl", std::process::id()));
    std::fs::write(&file, lines).ok();

    // The summary: per document and pause kind, and overall.
    let verdict = |s: &Sample| s.verdict["verdict"].as_str().unwrap_or("").to_string();
    let report = |label: &str, group: &[&Sample]| {
        let n = group.len().max(1) as f64;
        let count = |v: &str| group.iter().filter(|s| verdict(s) == v).count();
        let mut ms: Vec<u128> = group.iter().map(|s| s.ms).filter(|&m| m > 0).collect();
        ms.sort();
        let chars: usize = group.iter().map(|s| s.suggestion.chars().count()).sum();
        let shown = group.len() - count("empty");
        eprintln!(
            "{label:<14} n={:<3} accept {:>3.0}%  partial {:>3.0}%  reject {:>3.0}%  empty {:>3.0}%  | shown {:>3.0}%, useful when shown {:>3.0}% | {:>4} chars avg | p50 {} ms p90 {} ms",
            group.len(),
            100.0 * count("accept") as f64 / n,
            100.0 * count("partial") as f64 / n,
            100.0 * count("reject") as f64 / n,
            100.0 * count("empty") as f64 / n,
            100.0 * shown as f64 / n,
            100.0 * (count("accept") + count("partial")) as f64 / shown.max(1) as f64,
            chars / group.len().max(1),
            percentile(&ms, 0.5),
            percentile(&ms, 0.9),
        );
    };
    eprintln!(
        "\nlive_eval: completion replay on {model}{} ({} pauses) -> {}",
        if extra.is_empty() {
            String::new()
        } else {
            " + extra".into()
        },
        samples.len(),
        file.display()
    );
    let all: Vec<&Sample> = samples.iter().collect();
    report("all", &all);
    for kind in ["word", "sentence", "clause", "paragraph"] {
        let g: Vec<&Sample> = samples.iter().filter(|s| s.kind == kind).collect();
        report(kind, &g);
    }
    let mut ids: Vec<&str> = samples.iter().map(|s| s.doc).collect();
    ids.dedup();
    for id in ids {
        let g: Vec<&Sample> = samples.iter().filter(|s| s.doc == id).collect();
        report(id, &g);
    }
    let mut flags: std::collections::BTreeMap<String, usize> = Default::default();
    for s in &samples {
        for f in s.verdict["flags"].as_array().into_iter().flatten() {
            *flags
                .entry(f.as_str().unwrap_or("").to_string())
                .or_default() += 1;
        }
    }
    eprintln!("flags: {flags:?}");
    eprintln!("spent so far: ${:.2}", harness::spent_usd());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pauses_fall_after_sentences_clauses_and_paragraphs() {
        let text = "第一句话已经完完整整地写完了。第二句写到这里，还没有写完。\n\nNext one starts here, and goes on. Then ends.";
        let kinds: Vec<(&str, String)> = pauses(text)
            .iter()
            .map(|p| {
                let before: Vec<char> = text[..p.at].chars().collect();
                (
                    p.kind,
                    before[before.len().saturating_sub(3)..].iter().collect(),
                )
            })
            .collect();
        assert!(kinds.iter().any(|(k, _)| *k == "paragraph"));
        assert!(kinds
            .iter()
            .any(|(k, t)| *k == "sentence" && t.ends_with('。')));
        assert!(kinds
            .iter()
            .any(|(k, t)| *k == "clause" && t.ends_with('，')));
        // No pause at a paragraph's end: the next one is the paragraph one.
        assert!(pauses(text)
            .iter()
            .all(|p| !text[..p.at].ends_with("没有写完。")));
        assert_eq!(
            actual_next("ab. Cd ef gh ij kl mn op qr st. Uv", 4),
            "Cd ef gh ij kl mn op qr st."
        );
    }
}
