use super::*;
use serde_json::json;

/// The cases doc-blocks.test.ts checks too, so both split alike.
fn shared_cases() -> Vec<(String, Vec<String>)> {
    let raw = include_str!("../../../../src/ai/doc-blocks-cases.json");
    let cases: Vec<Value> = serde_json::from_str(raw).unwrap();
    cases
        .into_iter()
        .map(|c| {
            (
                c["document"].as_str().unwrap().to_string(),
                c["blocks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_str().unwrap().to_string())
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn splits_as_the_shared_cases_say() {
    for (document, expected) in shared_cases() {
        let got: Vec<String> = split(&document)
            .iter()
            .map(|b| format!("{} {}", b.id, &document[b.start..b.end]))
            .collect();
        assert_eq!(got, expected, "{document:?}");
    }
}

#[test]
fn marks_each_block_with_its_id() {
    let doc = "# Title\n\nOne.\n\nTwo.";
    let blocks = split(doc);
    let shown = annotate(doc, &blocks, 0, doc.len());
    assert_eq!(
        shown,
        format!(
            "[#{}] # Title\n\n[#{}] One.\n\n[#{}] Two.",
            blocks[0].id, blocks[1].id, blocks[2].id
        )
    );
}

#[test]
fn a_comment_or_picture_by_block_quotes_the_block_or_keeps_its_phrase() {
    let doc = "# Title\n\nThe cat sat on the mat.\n\n![Cat](cat.png)\n\nThe cat sat.";
    let blocks = split(doc);
    let args = |json: Value| {
        serde_json::from_str::<Value>(&resolve_target_arguments(doc, &blocks, &json.to_string()))
            .unwrap()
    };
    // A whole paragraph.
    let whole = args(json!({"block": blocks[1].id, "comment": "Vague."}));
    assert_eq!(whole["anchor"], "The cat sat on the mat.");
    assert!(whole.get("block").is_none());
    // A few words in it, repeated elsewhere: pinned by the block.
    let words = args(json!({"anchor": "The cat sat", "block": blocks[1].id, "comment": "x"}));
    assert_eq!(words["anchor"], "The cat sat");
    assert_eq!(words["context"], "The cat sat on the mat.");
    // A picture to redo, by its block; strict-schema empties go.
    let redo =
        args(json!({"action": "replace", "anchor": "", "block": blocks[2].id, "prompt": "p"}));
    assert_eq!(redo["anchor"], "![Cat](cat.png)");
    // An unknown id stays, for the tool to refuse.
    let unknown = args(json!({"block": "zzzz", "comment": "x"}));
    assert_eq!(unknown["block"], "zzzz");
}

#[test]
fn a_block_becomes_its_whole_text() {
    let doc = "# Title\n\nThe cat sat on the mat.\n\nThe end.";
    let blocks = split(doc);
    let id = &blocks[1].id;
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r#"{{"action":"replace","block":"{id}","text":"A dog lay down."}}"#),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "The cat sat on the mat.");
    assert_eq!(v["text"], "A dog lay down.");
    assert!(v.get("block").is_none());
}

#[test]
fn words_in_a_block_become_the_block_with_them_changed() {
    let doc = "One cat.\n\nThe cat sat on the mat.";
    let blocks = split(doc);
    let id = &blocks[1].id;
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r##"{{"action":"replace","block":"#{id}","anchor":"cat","text":"dog"}}"##),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "The cat sat on the mat.");
    assert_eq!(v["text"], "The dog sat on the mat.");
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r#"{{"action":"delete","block":"{id}","anchor":" on the mat"}}"#),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["action"], "replace");
    assert_eq!(v["text"], "The cat sat.");
}

#[test]
fn an_insertion_next_to_words_in_a_block_stays_next_to_them() {
    let doc = "- one\n- two\n- three\n\nAnd two more.";
    let blocks = split(doc);
    let id = &blocks[0].id;
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(
            r#"{{"action":"insert_after","block":"{id}","anchor":"- two","text":"- two and a half"}}"#
        ),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "- two");
    // "two" is elsewhere too; "- two" isn't, so no context is needed.
    assert!(v.get("context").is_none() && v.get("block").is_none());
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(
            r#"{{"action":"insert_after","block":"{id}","anchor":"two","text":" and a half"}}"#
        ),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "two");
    assert_eq!(v["context"], "- one\n- two\n- three");
}

#[test]
fn a_repeated_block_is_told_apart_by_the_one_before() {
    let doc = "First.\n\n---\n\nSecond.\n\n---";
    let blocks = split(doc);
    assert_ne!(blocks[1].id, blocks[3].id);
    let id = &blocks[3].id;
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r#"{{"action":"delete","block":"{id}"}}"#),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "---");
    assert_eq!(v["context"], "Second.\n\n---");
}

#[test]
fn a_run_of_blocks_becomes_their_text_from_first_to_last() {
    let doc = "# T\n\nOne.\n\nTwo.\n\nThree.";
    let blocks = split(doc);
    let (a, b) = (&blocks[1].id, &blocks[2].id);
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(
            r#"{{"action":"replace","anchor":"","block":"{a}","context":"","last_block":"{b}","text":"1.\n\n2."}}"#
        ),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "One.\n\nTwo.");
    assert!(v.get("context").is_none() && v.get("last_block").is_none());
    // The wrong way round names nothing.
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r#"{{"action":"replace","block":"{b}","last_block":"{a}","text":"x"}}"#),
    );
    assert!(out.contains("\"block\""));
}

#[test]
fn an_unknown_id_stays_for_propose_edit_to_refuse() {
    let doc = "One.";
    let out = resolve_edit_arguments(doc, &split(doc), r#"{"action":"delete","block":"zzzz"}"#);
    assert!(out.contains("\"block\""));
}

#[test]
fn markers_copied_into_text_come_out() {
    let doc = "One.";
    let out = resolve_edit_arguments(
        doc,
        &split(doc),
        r#"{"action":"replace","anchor":"[#ab12] One.","text":"[#ab12] Two. [#] stays"}"#,
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["anchor"], "One.");
    assert_eq!(v["text"], "Two. [#] stays");
}

/// The cases doc-blocks.test.ts checks too: a rewrite of the whole
/// document, run through keep_pictures, comes out the same both sides.
#[test]
fn keeps_pictures_as_the_shared_cases_say() {
    let raw = include_str!("../../../../src/ai/keep-pictures-cases.json");
    let cases: Vec<Value> = serde_json::from_str(raw).unwrap();
    for case in cases {
        let document = case["document"].as_str().unwrap();
        let (got, swapped) = keep_pictures(
            document,
            &split(document),
            case["text"].as_str().unwrap(),
            case["complete"].as_bool().unwrap(),
        );
        assert_eq!(got, case["expected"].as_str().unwrap(), "{}", case["name"]);
        assert_eq!(
            swapped as u64,
            case["swapped"].as_u64().unwrap_or(0),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn a_rewrite_of_a_run_keeps_the_pictures_it_left_out() {
    let doc = "One.\n\n![a](a.png)\n\nTwo.";
    let blocks = split(doc);
    let (a, b) = (&blocks[0].id, &blocks[2].id);
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(r#"{{"action":"replace","block":"{a}","last_block":"{b}","text":"Uno.\n\nDos."}}"#),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["text"], "Uno.\n\n![a](a.png)\n\nDos.");
}

#[test]
fn a_rewrite_of_a_run_that_swaps_a_picture_keeps_it_and_says_so() {
    let doc = "One.\n\n![a](a.png)\n\nTwo.";
    let blocks = split(doc);
    let (a, b) = (&blocks[0].id, &blocks[2].id);
    let out = resolve_edit_arguments(
        doc,
        &blocks,
        &format!(
            r#"{{"action":"replace","block":"{a}","last_block":"{b}","text":"Uno.\n\n![b](b.png)\n\nDos."}}"#
        ),
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["text"], "Uno.\n\n![a](a.png)\n\nDos.");
    assert_eq!(v[PICTURES_KEPT_KEY], 1);
}
