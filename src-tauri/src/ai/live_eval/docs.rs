//! The documents the agent matrix works on - the ones in docs/*.md are
//! byte-exact copies of what the editor shows the model (src/editor/
//! eval-docs.test.ts round-trips each through the real editor: `*`
//! bullets, padded tables, no trailing newline). One short report written in
//! every matrix language (same facts, same shape: title, intro, a wordy
//! Method paragraph to tighten, Findings with numbers to keep, a one-line
//! next step), a Chinese/English tech write-up for mixed text, and one
//! document carrying every Markdown construct the editor supports.

use super::checks::Lang;

pub struct LangDoc {
    pub lang: Lang,
    pub doc: &'static str,
    /// "Make the Method paragraph more concise", in this language.
    pub shorten: &'static str,
    /// "How many participants by December, and the top complaint?"
    pub question: &'static str,
}

pub const LANG_DOCS: &[LangDoc] = &[
    LangDoc {
        lang: Lang::En,
        doc: include_str!("docs/lang-en.md"),
        shorten: "Make the Method paragraph more concise.",
        question:
            "How many participants were there by December, and what did people complain about most?",
    },
    LangDoc {
        lang: Lang::ZhHans,
        doc: include_str!("docs/lang-zh-hans.md"),
        shorten: "把“方法”这一段改得更简洁。",
        question: "到十二月有多少参与者？大家最常抱怨什么？",
    },
    LangDoc {
        lang: Lang::ZhHant,
        doc: include_str!("docs/lang-zh-hant.md"),
        shorten: "把「方法」這一段改得更精簡。",
        question: "到十二月有多少參與者？大家最常抱怨什麼？",
    },
    LangDoc {
        lang: Lang::Ja,
        doc: include_str!("docs/lang-ja.md"),
        shorten: "「方法」の段落をもっと簡潔にしてください。",
        question: "12月の時点で参加者は何人でしたか？いちばん多かった不満は何ですか？",
    },
    LangDoc {
        lang: Lang::Ko,
        doc: include_str!("docs/lang-ko.md"),
        shorten: "'방법' 문단을 더 간결하게 다듬어 주세요.",
        question: "12월까지 참가자는 몇 명이었고, 가장 많이 나온 불만은 무엇이었나요?",
    },
    LangDoc {
        lang: Lang::Es,
        doc: include_str!("docs/lang-es.md"),
        shorten: "Haz más conciso el párrafo de Método.",
        question: "¿Cuántos participantes había en diciembre y cuál fue la queja más común?",
    },
    LangDoc {
        lang: Lang::Fr,
        doc: include_str!("docs/lang-fr.md"),
        shorten: "Rends le paragraphe Méthode plus concis.",
        question:
            "Combien de participants y avait-il en décembre, et de quoi se plaignait-on le plus ?",
    },
    LangDoc {
        lang: Lang::De,
        doc: include_str!("docs/lang-de.md"),
        shorten: "Formuliere den Absatz unter „Methode“ knapper.",
        question:
            "Wie viele Teilnehmende gab es im Dezember, und worüber wurde am häufigsten geklagt?",
    },
    LangDoc {
        lang: Lang::Ru,
        doc: include_str!("docs/lang-ru.md"),
        shorten: "Сделай абзац в разделе «Метод» более лаконичным.",
        question: "Сколько участников было к декабрю и на что чаще всего жаловались?",
    },
    LangDoc {
        lang: Lang::Pt,
        doc: include_str!("docs/lang-pt.md"),
        shorten: "Deixe o parágrafo de Método mais conciso.",
        question: "Quantos participantes havia em dezembro e qual foi a reclamação mais comum?",
    },
    LangDoc {
        lang: Lang::Mixed,
        doc: include_str!("docs/lang-mixed.md"),
        shorten: "把“过程”这一段改简洁一些。",
        question: "安装包体积和冷启动分别优化了多少？",
    },
];

pub fn lang_doc(lang: Lang) -> &'static LangDoc {
    LANG_DOCS
        .iter()
        .find(|d| d.lang == lang)
        .expect("doc for language")
}

/// The n-th body paragraph (0-based; headings skipped) - 0 intro, 1 Method,
/// 2 Findings, 3 the closing line.
pub fn para(doc: &str, n: usize) -> &str {
    doc.split("\n\n")
        .map(str::trim)
        .filter(|b| !b.is_empty() && !b.starts_with('#'))
        .nth(n)
        .expect("paragraph exists")
}

/// Every construct the editor round-trips: front matter, an alert, a table,
/// a task list, nested lists, inline and block math, a footnote, a link and
/// an image, fenced Python with a bug in it, Mermaid, and raw HTML.
pub const RICH_DOC: &str = include_str!("docs/rich.md");

/// A Chinese counterpart for the structures most often edited in place.
pub const RICH_DOC_ZH: &str = include_str!("docs/rich-zh.md");

/// Japanese task list for checking items off in place.
pub const TASKS_DOC_JA: &str = include_str!("docs/tasks-ja.md");

// Everyday writing, Chinese and English: what people actually open the
// assistant on. Each is in the editor's own Markdown form (see the top).
pub const EMAIL_EN: &str = include_str!("docs/email-en.md");
pub const EMAIL_ZH: &str = include_str!("docs/email-zh.md");
pub const WEEKLY_ZH: &str = include_str!("docs/weekly-zh.md");
pub const SUPPORT_EN: &str = include_str!("docs/support-en.md");
pub const ACADEMIC_EN: &str = include_str!("docs/academic-en.md");
pub const ACADEMIC_ZH: &str = include_str!("docs/academic-zh.md");
pub const TECH_EN: &str = include_str!("docs/tech-en.md");
pub const TECH_ZH: &str = include_str!("docs/tech-zh.md");
pub const MEETING_EN: &str = include_str!("docs/meeting-en.md");
pub const MEETING_ZH: &str = include_str!("docs/meeting-zh.md");
pub const ESSAY_EN: &str = include_str!("docs/essay-en.md");
pub const ESSAY_ZH: &str = include_str!("docs/essay-zh.md");
pub const NOVEL_EN: &str = include_str!("docs/novel-en.md");
pub const NOVEL_ZH: &str = include_str!("docs/novel-zh.md");
pub const SOCIAL_EN: &str = include_str!("docs/social-en.md");
pub const SOCIAL_ZH: &str = include_str!("docs/social-zh.md");
pub const PRODUCT_EN: &str = include_str!("docs/product-en.md");
pub const PRODUCT_ZH: &str = include_str!("docs/product-zh.md");

// Workspace and style-profile cases.
pub const NOTES_ZH: &str = include_str!("docs/notes-zh.md");
pub const STORY_EN: &str = include_str!("docs/story-en.md");
pub const BUDGET_EN: &str = include_str!("docs/budget-en.md");
pub const INVITE_ZH: &str = include_str!("docs/invite-zh.md");
pub const BETA_EN: &str = include_str!("docs/beta-en.md");
pub const MOVING_ZH: &str = include_str!("docs/moving-zh.md");
pub const MOVING_EN: &str = include_str!("docs/moving-en.md");

/// About 42k characters of Chinese - just past the 40k full-document limit,
/// so the model sees an outline and the start and end, and has to read
/// chapter 7 to edit or quote its second paragraph (a hand-written one;
/// the rest is generated survey prose).
pub fn long_doc_zh() -> String {
    let chapters = [
        "背景",
        "调研方法",
        "人口结构",
        "住房现状",
        "公共空间",
        "商业业态",
        "试点经验",
        "居民意愿",
        "资金安排",
        "风险评估",
        "政策建议",
        "结论",
    ];
    let streets = ["青石巷", "柳荫街", "南门坊", "织造路", "东关", "白塔寺"];
    let mut doc = String::from("# 老城区更新调研报告\n\n");
    for (c, title) in chapters.iter().enumerate() {
        doc.push_str(&format!(
            "## 第{}章 {title}\n\n",
            [
                "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"
            ][c]
        ));
        for p in 0..6 {
            if c == 6 && p == 1 {
                doc.push_str(LONG_ZH_TARGET);
                doc.push_str("\n\n");
                continue;
            }
            let mut para = String::new();
            for k in 0..9 {
                para.push_str(&format!(
                    "在{title}部分的第{}组访谈中，第{}位受访者提到，{}街道在过去一年里共有{}户居民参加了议事会，工作人员把这些意见逐条录入了台账。",
                    p + 1,
                    k + 1,
                    streets[(c + p + k) % streets.len()],
                    (c * 37 + p * 11 + k * 7) % 180 + 20
                ));
            }
            doc.push_str(&para);
            doc.push_str("\n\n");
        }
    }
    doc.trim_end().to_string()
}

/// The first eight chapters of long_doc_zh: about 28,000 characters, which
/// used to be embedded whole and is now past the full-document limit in
/// token-like units (agent::FULL_DOCUMENT_LIMIT).
pub fn mid_doc_zh() -> String {
    let doc = long_doc_zh();
    let end = doc.find("## 第九章").expect("chapter 9");
    doc[..end].trim_end().to_string()
}

/// Chapter 7's second paragraph in long_doc_zh: wordy, with the figures an
/// edit must keep.
pub const LONG_ZH_TARGET: &str = "在整个试点推进的过程当中，我们的工作人员前前后后一共走访了青石巷街道的 214 户居民，花了差不多整整三个月的时间，一家一家地上门去听取大家对改造方案的意见和建议，最后发现大家普遍反映最集中、最关心的问题，其实主要还是集中在改造期间的临时安置和改造完成之后房租会不会上涨这两个方面。";
