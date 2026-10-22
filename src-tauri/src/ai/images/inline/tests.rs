use super::*;

#[test]
fn a_picture_line_has_an_alt_an_aspect_and_a_description() {
    assert_eq!(
        picture_line("![港口](textus-picture:16:9 A harbour at dawn (soft light))"),
        Some(PictureLine {
            alt: "港口",
            prompt: "A harbour at dawn (soft light)",
            aspect: Aspect::Wide,
        })
    );
    assert_eq!(
        picture_line("  ![x](textus-picture: Boats)  ").map(|p| p.aspect),
        Some(Aspect::Square)
    );
    assert_eq!(picture_line("![x](textus-picture:)"), None);
    assert_eq!(picture_line("![x](picture.png)"), None);
    assert_eq!(picture_line("Text ![x](textus-picture:Boats) more"), None);
}

#[test]
fn a_string_streaming_in_is_read_as_far_as_it_has_come() {
    assert_eq!(partial_string(r#"{"action":"append","te"#, "text"), None);
    assert_eq!(
        partial_string(r#"{"anchor":"say \"text\": no","text":"a\nb"#, "text"),
        Some(("a\nb".into(), false))
    );
    assert_eq!(
        partial_string(r#"{"text":"港😀!"}"#, "text"),
        Some(("港😀!".into(), true))
    );
    assert_eq!(
        partial_string(r#"{"text":"ab\u6e"#, "text"),
        Some(("ab".into(), false))
    );
}

fn streamed(pictures: &InlinePictures<'_>, call_id: &str, json: &str) -> Vec<String> {
    pictures.observe(&ProviderEvent::ToolStart {
        call_id,
        name: "propose_edit",
    });
    let mut started = Vec::new();
    // Three characters at a time, as a provider might send them.
    let chars: Vec<char> = json.chars().collect();
    for chunk in chars.chunks(3) {
        let delta: String = chunk.iter().collect();
        for event in pictures.observe(&ProviderEvent::ToolArgs {
            call_id,
            delta: &delta,
        }) {
            if let StreamEvent::Picture { id, line, .. } = event {
                started.push(format!("{line} -> {id}"));
            }
        }
    }
    started
}

#[test]
fn each_picture_starts_once_its_line_has_streamed_in() {
    let run = ImageRun::offline(2);
    let ledger = Mutex::default();
    let pictures = run.inline(&ledger);
    let text =
        "One.\n\n![港口](textus-picture:16:9 Harbour)\n\nTwo.\n\n![船](textus-picture:Boats)";
    let json = serde_json::json!({"action": "append", "text": text}).to_string();
    let started = streamed(&pictures, "c1", &json);
    assert_eq!(started.len(), 2, "{started:?}");
    assert!(started[0].starts_with("![港口](textus-picture:16:9 Harbour) -> "));
    // The finished step: the same two pictures, now in the text.
    let step = pictures.place(StepResult::ToolCalls(vec![AgentTurn::ToolCall {
        call_id: "c1".into(),
        name: "propose_edit".into(),
        arguments: json,
        reasoning: None,
    }]));
    let StepResult::ToolCalls(calls) = step else {
        panic!()
    };
    let AgentTurn::ToolCall { arguments, .. } = &calls[0] else {
        panic!()
    };
    let placed: Value = serde_json::from_str(arguments).unwrap();
    let placed = placed["text"].as_str().unwrap();
    let first = started[0].rsplit(' ').next().unwrap();
    assert!(
        placed.contains(&format!("![港口](textus-generated:{first})")),
        "{placed}"
    );
    assert_eq!(placed.matches("textus-generated:").count(), 2);
    assert!(!placed.contains(PICTURE_SCHEME));
}

#[test]
fn a_picture_past_the_limit_is_left_out_and_said_why() {
    let run = ImageRun::offline(1);
    let ledger = Mutex::default();
    let pictures = run.inline(&ledger);
    let text = "One.\n\n![a](textus-picture:A)\n\nTwo.\n\n![b](textus-picture:B)\n\nThree.";
    let args = serde_json::json!({"action": "append", "text": text}).to_string();
    let placed: Value = serde_json::from_str(&pictures.place_in(&args).unwrap()).unwrap();
    assert_eq!(
        placed["text"]
            .as_str()
            .unwrap()
            .matches("textus-generated:")
            .count(),
        1
    );
    assert!(placed["text"].as_str().unwrap().ends_with("Two.\n\nThree."));
    let note = ledger.lock().unwrap().take_unmade();
    assert!(note.is_some_and(|n| n.contains("1 pictures")));
}

#[test]
fn a_line_asked_for_again_is_the_same_picture() {
    let run = ImageRun::offline(2);
    let ledger = Mutex::default();
    let pictures = run.inline(&ledger);
    let json = serde_json::json!({"text": "![a](textus-picture:A)\n"}).to_string();
    let first = streamed(&pictures, "c1", &json);
    assert_eq!(first.len(), 1);
    // A retried step writes the line again: the same picture, told
    // again for the new call, and no second one made.
    assert_eq!(streamed(&pictures, "c2", &json), first);
    assert_eq!(ledger.lock().unwrap().pictures().len(), 1);
}
