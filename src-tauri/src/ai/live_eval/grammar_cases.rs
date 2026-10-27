//! More grammar cases: Chinese and English mistakes, mixed text, inline
//! formatting every fix must leave intact, correct text that must stay clean,
//! and long multi-mistake paragraphs, plus one case in each other language.

use super::checks::Lang;
use super::grammar_matrix::{GrammarCase, G};

pub const MORE: &[GrammarCase] = &[
    // Chinese.
    GrammarCase { id: "zh/de-di-de-two/standard", lang: Lang::ZhHans, paragraph: "他认真的看着我，一个字一个字地解释，跑的最快的那个人是他弟弟。", fixes: &[("认真的看", "认真地看"), ("跑的最快", "跑得最快")], protected: &["一个字一个字地"], ..G },
    GrammarCase { id: "zh/de-di-de-clean/standard", lang: Lang::ZhHans, paragraph: "她穿着一件红色的大衣，安静地坐在窗边，字写得很工整。", ..G },
    GrammarCase { id: "zh/halfwidth-punct/standard", lang: Lang::ZhHans, paragraph: "今天下午开会,大家讨论了三个问题.第一个是明年的预算。", fixes: &[(",", "会，大"), (".", "题。第")], ..G },
    GrammarCase { id: "zh/mixed-spacing-clean/standard", lang: Lang::Mixed, paragraph: "我们用 Python 写了一个脚本，每天凌晨 2 点自动备份数据库（MySQL 8.0），备份文件保留 30 天。", protected: &["Python", "MySQL 8.0", "2 点", "30 天"], ..G },
    GrammarCase { id: "zh/homophone/standard", lang: Lang::ZhHans, paragraph: "这个方案的优势在于成本低，缺点是部署比较麻烦，我们还需要再三考虑，把风险想清处。", fixes: &[("清处", "清楚")], ..G },
    GrammarCase { id: "zh/typo-reward/standard", lang: Lang::ZhHans, paragraph: "经过大家几个月的努力，项目终于按时上线了，公司决定给团队发放奖今。", fixes: &[("奖今", "奖金")], ..G },
    GrammarCase { id: "zh/markdown-inline/standard", lang: Lang::ZhHans, markdown: Some("我们**非常**高兴的宣布，`v2.0` 已经发布，详情请见[更新日志](https://example.com/changelog)。"), fixes: &[("高兴的宣布", "高兴地宣布")], protected: &["v2.0", "更新日志"], ..G },
    GrammarCase { id: "zh/mixed-typo/standard", lang: Lang::Mixed, paragraph: "这次 release 我们修复了 3 个 bug，并且优化了冷启动速渡，用户反馈不错。", fixes: &[("速渡", "速度")], protected: &["release", "bug"], ..G },
    GrammarCase { id: "zh/redundant/strict", lang: Lang::ZhHans, strictness: "strict", paragraph: "会上我们大家一起共同讨论了下个季度的计划。", fixes: &[("一起共同", "大家一起讨论|大家共同讨论|一起讨论|共同讨论")], extra: 2, ..G },
    GrammarCase { id: "zh/clean-long/standard", lang: Lang::ZhHans, paragraph: "调研组在三个月里走访了六个街道，和两百多位居民谈过话。多数人支持改造，但希望施工能分段进行，并且在动工之前就把临时安置的方案公布出来，让大家心里有数。", ..G },
    GrammarCase { id: "zh/typos-only/typos", lang: Lang::ZhHans, strictness: "typos", paragraph: "他高兴的跳了起来，跑去告诉妈妈这个好消息，妈妈听了也很开新。", fixes: &[("开新", "开心")], protected: &["高兴的跳"], ..G },
    GrammarCase { id: "zh/dialogue-colloquial/standard", lang: Lang::ZhHans, paragraph: "“吃了没？”奶奶在门口喊，“没吃就在这儿吃呗，锅里还有饺子。”", protected: &["吃了没", "吃呗"], ..G },
    GrammarCase { id: "zh/measure-word/standard", lang: Lang::ZhHans, paragraph: "周末我在书店买了三个书，又给孩子买了两条裤子。", fixes: &[("三个书", "三本书")], protected: &["两条裤子"], ..G },

    // English.
    GrammarCase { id: "en/articles/standard", lang: Lang::En, paragraph: "She is an university student and has a honest opinion about the exam.", fixes: &[("an university", "a university"), ("a honest", "an honest")], ..G },
    GrammarCase { id: "en/missing-articles/standard", lang: Lang::En, paragraph: "We went to the cinema on Friday and saw film about history of the Roman army.", fixes: &[("saw film", "saw a film|saw the film"), ("about history", "about the history")], ..G },
    GrammarCase { id: "en/agreement-two/standard", lang: Lang::En, paragraph: "The list of new features are long, and neither of the managers have read it yet.", fixes: &[("are long", "list of new features is long"), ("have read", "managers has read")], ..G },
    GrammarCase { id: "en/tense/standard", lang: Lang::En, paragraph: "Yesterday I go to the market and buy some apples that were on sale.", fixes: &[("go to", "went to"), ("buy some", "bought some")], ..G },
    GrammarCase { id: "en/run-on/standard", lang: Lang::En, paragraph: "The meeting ran late, we missed the last train home.", fixes: &[("late, we", "late. We|late; we|late, so we|late and we|late, and we")], ..G },
    GrammarCase { id: "en/markdown-code-untouched/standard", lang: Lang::En, markdown: Some("Run `npm instal` and read the **offical** [setup guide](https://example.com/setup) before you start."), fixes: &[("offical", "official")], protected: &["npm instal", "setup guide"], ..G },
    GrammarCase { id: "en/markdown-link-bold/standard", lang: Lang::En, markdown: Some("See the [release notes](https://example.com/notes) for what has change in **version 2** of the app."), fixes: &[("has change", "has changed")], protected: &["release notes", "version 2"], ..G },
    GrammarCase { id: "en/its-agreement/standard", lang: Lang::En, paragraph: "The company changed it's logo last spring, and their sales has grown ever since.", fixes: &[("it's", "its logo"), ("has grown", "sales have grown")], ..G },
    GrammarCase { id: "en/clean-long/standard", lang: Lang::En, paragraph: "Although the pilot ran for only six weeks, the two branches that took part kept a shared log of every problem they hit, which turned out to be more useful than the survey we had planned to send at the end.", ..G },
    GrammarCase { id: "en/typos-only/typos", lang: Lang::En, strictness: "typos", paragraph: "We are going to recieve the package tomorow, so she need to be home.", fixes: &[("recieve", "receive"), ("tomorow", "tomorrow")], protected: &["need"], ..G },
    GrammarCase { id: "en/dialect-dialogue/standard", lang: Lang::En, paragraph: "\"I ain't never been to the city,\" she said, \"and I don't reckon I'll go now.\"", protected: &["I ain't never been to the city", "I don't reckon I'll go now"], ..G },
    GrammarCase { id: "en/british-clean/standard", lang: Lang::En, paragraph: "The colour of the theatre curtains was chosen to complement the organisation's new logo.", protected: &["colour", "theatre", "organisation's"], ..G },
    GrammarCase { id: "en/wordy/strict-two", lang: Lang::En, strictness: "strict", paragraph: "Due to the fact that the server was down, we were unable to make a decision on the matter.", fixes: &[("Due to the fact that", "Because|Since|As ")], extra: 3, ..G },
    GrammarCase { id: "en/mixed-zh-terms/standard", lang: Lang::En, paragraph: "Our team in Shenzhen calls the weekly sync \"周会\", and the notes are stored in Feishu so everyone can find it.", fixes: &[("find it", "find them")], protected: &["周会", "Feishu", "Shenzhen"], ..G },

    // Long multi-mistake paragraphs, and one more case per other language.
    GrammarCase { id: "ko/multi-long/standard", lang: Lang::Ko, paragraph: "어제 친구들과 함께 새로 생긴 식당에 갔는데 음식이 너무 맛있어서 다음에 또 오기로 약속햇다. 그런데 계산할 때 직원이 실수로 영수증을 두번 출력해서 조금 당황 했다. 그래도 사장님이 친절하게 사과하셔서 기분 좋게 나올수 있었다.", fixes: &[("약속햇다", "약속했다"), ("두번", "두 번"), ("당황 했다", "당황했다"), ("나올수", "나올 수")], extra: 1, ..G },
    GrammarCase { id: "de/multi-long/standard", lang: Lang::De, paragraph: "Gestern bin ich mit meine Freunde ins Kino gegangen. Der Film war sehr spannend, aber die Sitze waren unbequem und es war zu kalt in den Saal. Danach haben wir in einem kleinen Restaurant gegessen, obwohl der Kellner hat uns lange warten lassen.", fixes: &[("meine Freunde", "meinen Freunden"), ("in den Saal", "in dem Saal|im Saal"), ("hat uns lange warten lassen", "warten ließ|hat warten lassen")], extra: 1, ..G },
    GrammarCase { id: "zh-Hant/typo-late/standard", lang: Lang::ZhHant, paragraph: "我們明天早上九點在公司門口集合，請大家準時到達，不要遲倒。", fixes: &[("遲倒", "遲到")], ..G },
    GrammarCase { id: "ja/particles/standard", lang: Lang::Ja, paragraph: "私は昨日図書館を行きました。そこで面白い本が見つけました。", fixes: &[("図書館を", "図書館に|図書館へ"), ("本が見つけ", "本を見つけ|本が見つかり")], ..G },
    GrammarCase { id: "es/agreement-two/standard", lang: Lang::Es, paragraph: "Las casas blancos del pueblo son muy bonitas, pero la calle principal está sucio.", fixes: &[("blancos", "blancas"), ("sucio", "sucia")], ..G },
    GrammarCase { id: "fr/auxiliary/standard", lang: Lang::Fr, paragraph: "Hier, nous avons allé au marché et j'ai acheté des pommes rouge.", fixes: &[("avons allé", "nous sommes allés"), ("rouge", "pommes rouges")], ..G },
    GrammarCase { id: "ru/case-two/standard", lang: Lang::Ru, paragraph: "Я вчера читал интересная книга о истории России.", fixes: &[("интересная книга", "интересную книгу"), ("о истории", "об истории")], ..G },
    GrammarCase { id: "pt/agreement-two/standard", lang: Lang::Pt, paragraph: "As crianças está brincando no parque desde de manhã.", fixes: &[("está", "crianças estão"), ("desde de", "desde manhã|desde a manhã|desde cedo")], ..G },
];

#[cfg(test)]
mod tests {
    #[test]
    fn every_mistake_and_protected_span_is_in_its_paragraph() {
        for case in super::super::grammar_matrix::CASES
            .iter()
            .chain(super::MORE)
        {
            let text = case.text();
            assert!(!text.is_empty(), "{}: empty paragraph", case.id);
            for (wrong, _) in case.fixes {
                assert!(
                    text.contains(wrong),
                    "{}: {wrong:?} not in {text:?}",
                    case.id
                );
            }
            for p in case.protected {
                assert!(
                    text.contains(p),
                    "{}: protected {p:?} not in {text:?}",
                    case.id
                );
            }
        }
        let ids: std::collections::HashSet<&str> = super::super::grammar_matrix::CASES
            .iter()
            .chain(super::MORE)
            .map(|c| c.id)
            .collect();
        assert_eq!(
            ids.len(),
            super::super::grammar_matrix::CASES.len() + super::MORE.len()
        );
    }
}
