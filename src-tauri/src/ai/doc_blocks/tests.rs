use super::*;
use serde_json::json;

/// A document as the editor sends it: `(kind, markdown)` per block, ids
/// made the way doc-blocks.ts makes them.
fn editor(blocks: &[(&str, &str)]) -> Document {
    let ids = block_ids(blocks.iter().map(|(_, m)| *m));
    Document::from_blocks(
        blocks
            .iter()
            .zip(ids)
            .map(|((kind, markdown), id)| SentBlock {
                id,
                markdown: markdown.to_string(),
                kind: kind.to_string(),
            })
            .collect(),
    )
}

fn resolved(doc: &Document, args: Value) -> Value {
    serde_json::from_str(&resolve_edit_arguments(doc, &args.to_string())).unwrap()
}

#[test]
fn the_document_is_the_editors_blocks_joined() {
    // A loose list is one node, so one block - its blank lines inside it.
    let doc = editor(&[
        ("heading", "# Title"),
        ("list", "- one\n\n- two"),
        ("paragraph", "After."),
    ]);
    assert_eq!(doc.text, "# Title\n\n- one\n\n- two\n\nAfter.");
    assert_eq!(doc.blocks.len(), 2 + 1);
    assert_eq!(doc.block_text(&doc.blocks[1]), "- one\n\n- two");
    assert_eq!(doc.blocks[1].kind, "list");
}

#[test]
fn marks_each_block_with_its_id() {
    let doc = editor(&[
        ("heading", "# Title"),
        ("paragraph", "One."),
        ("paragraph", "Two."),
    ]);
    let b = &doc.blocks;
    assert_eq!(
        annotate(&doc, 0, doc.len()),
        format!(
            "[#{}] # Title\n\n[#{}] One.\n\n[#{}] Two.",
            b[0].id, b[1].id, b[2].id
        )
    );
}

#[test]
fn a_comment_or_picture_by_block_keeps_its_id_and_quotes_the_block_or_its_phrase() {
    let doc = Document::from_markdown(
        "# Title\n\nThe cat sat on the mat.\n\n![Cat](cat.png)\n\nThe cat sat.",
    );
    let b = &doc.blocks;
    let args = |json: Value| {
        serde_json::from_str::<Value>(&resolve_target_arguments(&doc, &json.to_string())).unwrap()
    };
    let whole = args(json!({"block": format!("#{}", b[1].id), "comment": "Vague."}));
    assert_eq!(whole["anchor"], "The cat sat on the mat.");
    assert_eq!(whole["block"], b[1].id);
    // A few words in it, though they repeat elsewhere: the block says where.
    let words = args(json!({"anchor": "The cat sat", "block": b[1].id, "comment": "x"}));
    assert_eq!(words["anchor"], "The cat sat");
    // A picture to redo, by its block; strict-schema empties go.
    let redo = args(json!({"action": "replace", "anchor": "", "block": b[2].id, "prompt": "p"}));
    assert_eq!(redo["anchor"], "![Cat](cat.png)");
    assert_eq!(b[2].kind, "picture");
    let unknown = args(json!({"block": "zzzz", "comment": "x"}));
    assert_eq!(unknown["block"], "zzzz");
    assert!(check_target(&doc, &unknown).is_err());
}

#[test]
fn a_block_is_its_whole_text_and_keeps_its_id() {
    let doc = Document::from_markdown("# Title\n\nThe cat sat on the mat.\n\nThe end.");
    let id = &doc.blocks[1].id;
    let v = resolved(
        &doc,
        json!({"action": "replace", "block": id, "text": "A dog lay down."}),
    );
    assert_eq!(v["anchor"], "The cat sat on the mat.");
    assert_eq!(v["text"], "A dog lay down.");
    assert_eq!(v["block"], *id);
    assert!(check_target(&doc, &v).is_ok());
}

#[test]
fn words_in_a_block_become_the_block_with_them_changed() {
    let doc = Document::from_markdown("One cat.\n\nThe cat sat on the mat.");
    let id = &doc.blocks[1].id;
    let v = resolved(
        &doc,
        json!({"action": "replace", "block": format!("#{id}"), "anchor": "cat", "text": "dog"}),
    );
    assert_eq!(v["anchor"], "The cat sat on the mat.");
    assert_eq!(v["text"], "The dog sat on the mat.");
    assert_eq!(v["block"], *id);
    let v = resolved(
        &doc,
        json!({"action": "delete", "block": id, "anchor": " on the mat"}),
    );
    assert_eq!(v["action"], "replace");
    assert_eq!(v["text"], "The cat sat.");
}

#[test]
fn words_not_in_the_block_once_are_refused() {
    let doc = Document::from_markdown("The cat and the cat.\n\nA dog.");
    let id = &doc.blocks[0].id;
    for quote in ["cat", "dog"] {
        let v = resolved(
            &doc,
            json!({"action": "replace", "block": id, "anchor": quote, "text": "x"}),
        );
        assert!(check_target(&doc, &v).is_err(), "{quote}");
    }
}

#[test]
fn an_insertion_next_to_words_in_a_block_stays_next_to_them() {
    let doc = editor(&[
        ("list", "- one\n- two\n- three"),
        ("paragraph", "And two more."),
    ]);
    let id = &doc.blocks[0].id;
    let v = resolved(
        &doc,
        json!({"action": "insert_after", "block": id, "anchor": "two", "text": " and a half"}),
    );
    // "two" is in the next paragraph too; the block says which is meant.
    assert_eq!(v["anchor"], "two");
    assert_eq!(v["block"], *id);
    let span = doc.target_span(&v).unwrap();
    assert_eq!(&doc.text[span.0..span.1], "two");
    assert!(span.1 < doc.blocks[0].end);
}

#[test]
fn a_repeated_block_has_an_id_of_its_own() {
    let doc = Document::from_markdown("First.\n\n---\n\nSecond.\n\n---");
    let b = &doc.blocks;
    assert_ne!(b[1].id, b[3].id);
    let v = resolved(&doc, json!({"action": "delete", "block": b[3].id}));
    assert_eq!(v["anchor"], "---");
    assert_eq!(doc.target_span(&v), Some((b[3].start, b[3].end)));
}

#[test]
fn a_run_of_blocks_is_their_text_from_first_to_last() {
    let doc = Document::from_markdown("# T\n\nOne.\n\nTwo.\n\nThree.");
    let (a, b) = (&doc.blocks[1].id, &doc.blocks[2].id);
    let v = resolved(
        &doc,
        json!({"action": "replace", "anchor": "", "block": a, "last_block": b, "text": "1.\n\n2."}),
    );
    assert_eq!(v["anchor"], "One.\n\nTwo.");
    assert_eq!(v["last_block"], *b);
    // A run of one is the block.
    let one = resolved(
        &doc,
        json!({"action": "replace", "block": a, "last_block": a, "text": "x"}),
    );
    assert!(one.get("last_block").is_none());
    // The wrong way round names nothing.
    let back = resolved(
        &doc,
        json!({"action": "replace", "block": b, "last_block": a, "text": "x"}),
    );
    assert!(check_target(&doc, &back).is_err());
}

#[test]
fn a_call_without_a_block_is_left_for_the_tool() {
    let doc = Document::from_markdown("One.");
    let v = resolved(
        &doc,
        json!({"action": "replace", "anchor": "[#ab12] One.", "text": "[#ab12] Two. [#] stays"}),
    );
    // Markers copied into the words come out all the same.
    assert_eq!(v["anchor"], "One.");
    assert_eq!(v["text"], "Two. [#] stays");
    assert_eq!(check_target(&doc, &v), Err(NO_BLOCK.to_string()));
}

/// The cases doc-blocks.test.ts checks too: a rewrite of the whole
/// document, run through keep_pictures, comes out the same both sides.
#[test]
fn keeps_pictures_as_the_shared_cases_say() {
    let raw = include_str!("../../../../src/ai/keep-pictures-cases.json");
    let cases: Vec<Value> = serde_json::from_str(raw).unwrap();
    for case in cases {
        let document = case["document"].as_str().unwrap();
        let run: Vec<&str> = paragraphs(document)
            .into_iter()
            .map(|(s, e)| &document[s..e])
            .collect();
        let (got, swapped) = keep_pictures(
            &run,
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
    let doc = editor(&[
        ("paragraph", "One."),
        ("picture", "![a](a.png)"),
        ("paragraph", "Two."),
    ]);
    let (a, b) = (&doc.blocks[0].id, &doc.blocks[2].id);
    let v = resolved(
        &doc,
        json!({"action": "replace", "block": a, "last_block": b, "text": "Uno.\n\nDos."}),
    );
    assert_eq!(v["text"], "Uno.\n\n![a](a.png)\n\nDos.");
}

#[test]
fn a_rewrite_of_a_run_that_swaps_a_picture_keeps_it_and_says_so() {
    let doc = Document::from_markdown("One.\n\n![a](a.png)\n\nTwo.");
    let (a, b) = (&doc.blocks[0].id, &doc.blocks[2].id);
    let v = resolved(
        &doc,
        json!({"action": "replace", "block": a, "last_block": b, "text": "Uno.\n\n![b](b.png)\n\nDos."}),
    );
    assert_eq!(v["text"], "Uno.\n\n![a](a.png)\n\nDos.");
    assert_eq!(v[PICTURES_KEPT_KEY], 1);
}
