use super::super::testing::*;
use super::super::{Block, Lang};

const J: Lang = Lang::Ja;

#[test]
fn widths_and_punctuation() {
    assert_eq!(fixed("ja.width.kana", J, None, "ｶﾞｲﾄﾞを読む"), "ガイドを読む");
    assert_eq!(
        fixed("ja.punct.halfwidth", J, None, "今日は雨,明日は晴れ."),
        "今日は雨、明日は晴れ。"
    );
    assert!(hits(
        "ja.punct.halfwidth",
        J,
        None,
        "バージョン 3.14 と URL の example.com"
    )
    .is_empty());
    // A document that writes ，． keeps them; a stray 、 is flagged.
    assert_eq!(
        hits(
            "ja.punct.halfwidth",
            J,
            None,
            "これは，本当に，そうです，ね．しかし、違う．"
        ),
        one("、", "，")
    );
    assert_eq!(
        fixed("ja.width.alnum", J, None, "第１０章のＡＩ"),
        "第10章のAI"
    );
    assert_eq!(
        fixed("ja.width.alnum", J, Some("ja/koyobun"), "第１０章のＱＯＬ"),
        "第10章のＱＯＬ"
    );
}

#[test]
fn spaces_are_removed_never_added() {
    // Automatic: a stray space in an unspaced document goes...
    assert_eq!(
        fixed(
            "ja.space.typed",
            J,
            None,
            "新しいAPIを使う。古いURLとJSONも消す。新しい API を使う"
        ),
        "新しいAPIを使う。古いURLとJSONも消す。新しいAPIを使う"
    );
    // ...but a document that spaces its Latin terms keeps them.
    assert!(hits("ja.space.typed", J, None, "新しい API を使う").is_empty());
    // A chosen profile removes them; a space inside a Latin phrase is
    // not a boundary.
    assert_eq!(
        fixed(
            "ja.space.typed",
            J,
            Some("ja/jtf"),
            "Visual Studio Code を使う"
        ),
        "Visual Studio Codeを使う"
    );
    // A missing space is never flagged.
    assert!(hits("ja.space.typed", J, None, "新しいAPIを使う").is_empty());
    assert_eq!(
        fixed("ja.space.fullwidth", J, None, "これは 本です。「 はい 」"),
        "これは本です。「はい」"
    );
    assert!(hits(
        "ja.space.fullwidth",
        J,
        None,
        "変更は 設定 → ショートカット の設定が優先されます"
    )
    .is_empty());
    // The full-width space after ！ stays.
    assert!(hits("ja.space.fullwidth", J, None, "本当ですか！\u{3000}すごい").is_empty());
    assert_eq!(
        fixed("ja.punct.after-exclaim", J, None, "本当！すごい"),
        "本当！\u{3000}すごい"
    );
    assert!(hits(
        "ja.punct.after-exclaim",
        J,
        None,
        "「本当！」と言った。やった！って"
    )
    .is_empty());
    assert!(hits(
        "ja.punct.after-exclaim",
        J,
        Some("ja/fiction"),
        "本当！すごい"
    )
    .is_empty());
}

#[test]
fn numbers_tildes_and_leaders() {
    assert_eq!(fixed("ja.punct.tilde", J, None, "10~20人"), "10～20人");
    assert_eq!(
        fixed("ja.num.counter", J, None, "3ヶ月と5ヵ所"),
        "3か月と5か所"
    );
    assert!(hits("ja.num.counter", J, None, "霞ケ関に行く").is_empty());
    assert_eq!(
        fixed("ja.punct.dots-dash", J, None, "そして...彼の言葉ーー去った"),
        "そして……彼の言葉――去った"
    );
    assert!(hits("ja.punct.dots-dash", J, None, "えーーと、そうですね").is_empty());
    assert_eq!(
        fixed("ja.punct.single-leader", J, None, "待って…それで"),
        "待って……それで"
    );
    assert!(hits(
        "ja.punct.single-leader",
        J,
        None,
        "メニューの「編集…」を選ぶ"
    )
    .is_empty());
    assert!(hits(
        "ja.punct.single-leader",
        J,
        Some("ja/koyobun"),
        "待って…それで"
    )
    .is_empty());
    assert_eq!(
        fixed("ja.num.kanji-digit", J, None, "5千人と3百円、1万円"),
        "5,000人と300円、1万円"
    );
}

#[test]
fn register_words_and_style() {
    let mixed = "雨が降ります。風が強いです。寒いです。明日は晴れである。";
    assert_eq!(
        hits("ja.style.register-mix", J, None, mixed),
        flagged("である")
    );
    assert!(hits_in("ja.style.register-mix", J, None, mixed, Block::ListItem).is_empty());
    assert_eq!(
        fixed("ja.word.ranuki", J, None, "ここから海が見れる。"),
        "ここから海が見られる。"
    );
    assert!(hits("ja.word.ranuki", J, None, "見れば分かる。").is_empty());
    assert!(hits("ja.word.ranuki", J, Some("ja/fiction"), "海が見れる。").is_empty());
    assert_eq!(
        hits("ja.style.no-repeat", J, None, "東京の会社の社長の娘。").len(),
        1
    );
    assert!(hits(
        "ja.style.no-repeat",
        J,
        None,
        "そのプロジェクトのものがこの方法のもの。"
    )
    .is_empty());
    assert_eq!(
        hits(
            "ja.style.double-negative",
            J,
            None,
            "行かないわけではない。"
        )
        .len(),
        1
    );
    assert_eq!(
        fixed(
            "ja.word.redundant",
            J,
            None,
            "参加することができる。第3回目の会議。"
        ),
        "参加できる。第3回の会議。"
    );
    assert_eq!(
        hits("ja.keigo.patterns", J, None, "社長がお帰りになられました。").len(),
        1
    );
    assert!(hits("ja.keigo.patterns", J, None, "とんでもございません。").is_empty());
    assert_eq!(
        fixed(
            "ja.punct.period-bracket",
            J,
            Some("ja/jtf"),
            "「はい。」と答えた"
        ),
        "「はい」と答えた"
    );
    assert!(hits("ja.punct.period-bracket", J, None, "「はい。」と答えた").is_empty());
}

#[test]
fn document_consistency() {
    let text = "コンピューターとコンピューターとコンピュータ。子どもと子どもと子供。取り扱いと取り扱いと取扱い。";
    assert_eq!(
        hits("ja.word.choon", J, None, text),
        one("コンピュータ", "コンピューター")
    );
    assert_eq!(hits("ja.word.kodomo", J, None, text), one("子供", "子ども"));
    assert_eq!(
        hits("ja.word.okurigana", J, None, text),
        one("取扱い", "取り扱い")
    );
    let long = "あ".repeat(120) + "。";
    assert_eq!(hits("ja.style.sentence-length", J, None, &long).len(), 1);
    assert!(hits("ja.style.sentence-length", J, Some("ja/fiction"), &long).is_empty());
}
