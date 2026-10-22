
use super::super::testing::*;
use super::super::Lang;

const K: Lang = Lang::Ko;

#[test]
fn particles_attach_but_units_and_quotes_stay() {
    assert_eq!(
        fixed(
            "ko.space.particle",
            K,
            None,
            "API 를 호출하고 v2 에서 확인했다."
        ),
        "API를 호출하고 v2에서 확인했다."
    );
    for ok in [
        "사과 3 개를 샀다",
        "기온이 30 도 이상",
        "“좋아” 하고 웃었다",
        "API 문서를 봤다",
    ] {
        assert!(hits("ko.space.particle", K, None, ok).is_empty(), "{ok}");
    }
}

#[test]
fn marks_and_spelling_lists() {
    assert_eq!(
        fixed("ko.punct.cjk-marks", K, None, "좋습니다。그리고、"),
        "좋습니다.그리고,"
    );
    assert_eq!(
        fixed("ko.word.myeochil", K, None, "몇일 걸려요?"),
        "며칠 걸려요?"
    );
    assert_eq!(
        fixed("ko.word.dwae", K, None, "안되요. 다 됬다."),
        "안돼요. 다 됐다."
    );
    assert_eq!(
        fixed("ko.word.saisiot", K, None, "햇님과 갯수"),
        "해님과 개수"
    );
    assert_eq!(
        fixed("ko.word.ryul", K, None, "실패률과 할인률"),
        "실패율과 할인율"
    );
    // 합격률 is right (률 after a consonant).
    assert!(hits("ko.word.ryul", K, None, "합격률").is_empty());
}

#[test]
fn dates_colons_and_hints() {
    assert_eq!(
        fixed("ko.date.format", K, None, "날짜: 2026.10.14 오전"),
        "날짜: 2026. 10. 14. 오전"
    );
    assert!(hits("ko.date.format", K, None, "버전 2026.10.14.3과 192.168.0.1").is_empty());
    assert!(hits("ko.date.format", K, None, "2026. 10. 14. 회의").is_empty());
    assert_eq!(
        fixed("ko.punct.colon-space", K, None, "장소 : 광화문, 일시:내일"),
        "장소: 광화문, 일시: 내일"
    );
    assert!(hits("ko.punct.colon-space", K, None, "10:20에 만나고 3:16 구절").is_empty());
    assert_eq!(
        hits("ko.word.double-passive", K, None, "잊혀진 계절").len(),
        1
    );
    assert_eq!(
        hits("ko.honorific.thing", K, None, "주문하신 커피 나오셨습니다.").len(),
        1
    );
}

#[test]
fn register_and_official_profile() {
    let text = "확인했습니다. 진행합니다. 완료됩니다. 좋아요.";
    assert_eq!(
        hits("ko.style.register-mix", K, None, text),
        flagged("좋아요")
    );
    // Instructions in -세요 are normal in a 하십시오체 manual.
    let manual = "확인했습니다. 진행합니다. 완료됩니다. 파일을 여세요.";
    assert!(hits("ko.style.register-mix", K, None, manual).is_empty());
    assert_eq!(
        fixed(
            "ko.official.format",
            K,
            Some("ko/official"),
            "오후 3시 30분에 시작"
        ),
        "15:30에 시작"
    );
    assert!(hits("ko.official.format", K, None, "오후 3시").is_empty());
}

#[test]
fn never_flag_in_korean() {
    let text = "비가 와서, 우리는 3 개를 샀고... 1,000원(?)이었다… “네” 하고 답했다.";
    let all = findings(K, None, text, super::super::Block::Paragraph);
    assert!(all.is_empty(), "{all:?}");
}
