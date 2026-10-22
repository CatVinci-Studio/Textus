use super::*;

#[test]
fn a_picture_request_offers_only_the_image_tool_at_the_aspects_size() {
    let body = image_request_body("A harbour at dusk", Aspect::Wide, None);
    assert_eq!(body["tools"][0]["type"], "image_generation");
    assert_eq!(body["tools"][0]["size"], "1536x1024");
    assert_eq!(body["tool_choice"]["type"], "image_generation");
    assert_eq!(body["stream"], true);
    assert_eq!(body["store"], false);
    assert_eq!(
        body["input"][0]["content"][0]["text"],
        "A harbour at dusk\n\nAspect ratio 16:9, 1536x1024 pixels."
    );
}

#[test]
fn a_picture_being_redone_goes_in_as_an_input_image() {
    let old = ImageAttachment {
        name: "old.jpg".into(),
        mime: "image/jpeg".into(),
        data_base64: "aGk=".into(),
    };
    let body = image_request_body("Make her hair red", Aspect::Square, Some(&old));
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["type"], "input_image");
    assert_eq!(content[0]["image_url"], "data:image/jpeg;base64,aGk=");
    assert!(content[1]["text"]
        .as_str()
        .unwrap()
        .starts_with("Make her hair red"));
}

#[test]
fn the_picture_is_read_from_the_image_generation_call() {
    // "hi" in base64, beside a message item.
    let output = vec![
        json!({"type": "message", "content": []}),
        json!({"type": "image_generation_call", "status": "completed", "result": "aGk="}),
    ];
    assert_eq!(image_from_output(&output).unwrap(), b"hi");
}

#[test]
fn no_picture_says_why() {
    let none = image_from_output(&[json!({"type": "message"})]).unwrap_err();
    assert!(matches!(none, ImageError::Failed(why) if why.contains("plan")));
    let unfinished = image_from_output(&[
        json!({"type": "image_generation_call", "status": "failed", "result": ""}),
    ])
    .unwrap_err();
    assert!(matches!(unfinished, ImageError::Failed(why) if why.contains("failed")));
}

#[test]
fn failures_are_told_apart() {
    assert!(matches!(
        image_failure("ChatGPT request failed: moderation_blocked".into()),
        ImageError::Refused(_)
    ));
    assert!(matches!(
        image_failure("ChatGPT request failed (429): usage limit reached".into()),
        ImageError::Quota(_)
    ));
    assert!(matches!(
        image_failure("ChatGPT request failed (500)".into()),
        ImageError::Failed(_)
    ));
}

/// The exact failure this guard exists for: a model saved while the
/// API-key auth method was active (or migrated forward from an older
/// settings blob) is a hard 400 once the login is a ChatGPT account.
#[test]
fn a_model_this_login_cannot_use_falls_back_to_the_default() {
    assert_eq!(usable_model(Some("gpt-5.4"), "gpt-6.1-sol"), "gpt-6.1-sol");
    assert_eq!(
        usable_model(Some("gpt-4o-mini"), "gpt-6.1-sol"),
        "gpt-6.1-sol"
    );
}

/// The GPT-5.6 family was the previous preset list; Codex no longer
/// serves it, so a choice saved by an older version must not survive.
#[test]
fn a_retired_preset_falls_back_to_the_default() {
    assert_eq!(
        usable_model(Some("gpt-5.6-terra"), "gpt-6.1-sol"),
        "gpt-6.1-sol"
    );
}

#[test]
fn a_supported_model_is_passed_through() {
    assert_eq!(
        usable_model(Some("gpt-6-astra"), "gpt-6.1-sol"),
        "gpt-6-astra"
    );
}

#[test]
fn no_choice_means_the_default() {
    assert_eq!(usable_model(None, "gpt-6.1-sol"), "gpt-6.1-sol");
}
