
use super::*;

#[test]
fn counts_spacing_quotes_and_register() {
    let mut s = Stats::default();
    s.count(
        &Text::new("我们用 React 写了 2 个工具,很快。"),
        Lang::ZhHans,
    );
    assert_eq!((s.cjk_latin_spaced, s.cjk_latin_tight), (4, 0));
    assert_eq!((s.cjk_fw_punct, s.cjk_hw_punct), (1, 1));
    let mut s = Stats::default();
    s.count(
        &Text::new("Il a dit : « oui » ; puis non! Il est 13:52."),
        Lang::Fr,
    );
    assert_eq!((s.fr_space, s.fr_none), (2, 1));
    let mut s = Stats::default();
    s.count(&Text::new("雨です。晴れである。曇りです。"), Lang::Ja);
    assert_eq!((s.ja_desu, s.ja_dearu), (2, 1));
    assert!(
        minority(1, 3) && minority(2, 4) && !minority(1, 2) && !minority(0, 5) && !minority(2, 3)
    );
}
