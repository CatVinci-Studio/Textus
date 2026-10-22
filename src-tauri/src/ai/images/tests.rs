use super::*;

fn run() -> ImageRun {
    ImageRun {
        job: ImageJob {
            app: None,
            api: ImageApi::OpenAi,
            // Nothing listens here: a picture asked for fails to
            // connect.
            base_url: "https://127.0.0.1:1".into(),
            api_key: "sk".into(),
            model: "gpt-image-2".into(),
        },
        made: AtomicUsize::new(0),
        limit: PER_SEND,
        folder: None,
    }
}

fn picture(id: &str) -> Result<GeneratedImageData, String> {
    tauri::async_runtime::block_on(ai_generated_image(id.to_string()))
}

fn call(run: &ImageRun, args: Value, document: &str) -> (Value, bool) {
    call_with(run, args, document, &[], &[])
}

/// A call with proposals not decided yet: this request's, and earlier
/// ones'.
fn call_with(
    run: &ImageRun,
    args: Value,
    document: &str,
    this_request: &[&str],
    undecided: &[UndecidedEdit],
) -> (Value, bool) {
    let this_request = std::sync::Mutex::new(ProposalLedger::with_texts(this_request));
    let proposed = ProposedText {
        this_request: &this_request,
        undecided,
    };
    let mut announced = false;
    let document = crate::ai::doc_blocks::Document::from_markdown(document);
    let args = named(&document, args);
    let out = tauri::async_runtime::block_on(
        run.run_call(&args, &document, &proposed, || announced = true),
    );
    (serde_json::from_str(&out).unwrap(), announced)
}

/// A call as the model sends it: naming the block its `anchor` is in (the
/// one block that holds it), resolved as agent::settle does. Words in no
/// block stay a quote.
fn named(document: &crate::ai::doc_blocks::Document, mut args: Value) -> String {
    if let Some(anchor) = args.get("anchor").and_then(|a| a.as_str()) {
        let holding: Vec<_> = document
            .blocks
            .iter()
            .filter(|b| document.block_text(b).contains(anchor))
            .collect();
        if args.get("block").is_none() && holding.len() == 1 {
            args["block"] = json!(holding[0].id);
        }
    }
    crate::ai::doc_blocks::resolve_target_arguments(document, &args.to_string())
}

const DOC: &str = "# Harbour\n\nThe boats came in at dusk.\n\nThe nets were mended by lamplight.";

#[test]
fn a_picture_with_a_width_can_be_redone() {
    // Written as HTML once it was given a width.
    let doc = "One.\n\n<img src=\"assets/a.png\" width=\"60%\">\n\nTwo.";
    let (args, made) = call(
        &run(),
        json!({"action": "replace", "anchor": "<img src=\"assets/a.png\" width=\"60%\">", "prompt": "p", "alt": "a"}),
        doc,
    );
    assert!(made, "{args}");
    assert!(is_picture_markdown("![a](b.png)"));
    assert!(!is_picture_markdown("<img src=a.png> and words"));
    assert!(!is_picture_markdown("<imgx>"));
}

#[test]
fn a_block_that_isnt_there_is_said_so() {
    let (args, made) = call(
        &run(),
        json!({"action": "insert_after", "block": "zzzz", "prompt": "p", "alt": "a"}),
        DOC,
    );
    assert!(!made);
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("no block has the id `zzzz`"));
}

#[test]
fn a_call_that_cant_be_placed_spends_nothing() {
    let run = run();
    let (args, announced) = call(
        &run,
        json!({"prompt": "boats", "alt": "Boats", "action": "insert_after", "anchor": "No such text."}),
        DOC,
    );
    assert!(!announced);
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("name the passage by its block"));
    assert!(args.get("image").is_none());
    let (args, _) = call(
        &run,
        json!({"prompt": "boats", "action": "replace", "anchor": "The boats came in at dusk."}),
        DOC,
    );
    // `replace` takes a picture, not text.
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("a picture replaces only a picture"));
    let (args, _) = call(&run, json!({"prompt": " ", "action": "append"}), DOC);
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("`prompt` is empty"));
    assert_eq!(run.made.load(Ordering::SeqCst), 0);
}

#[test]
fn what_the_model_wrote_under_image_is_never_taken_for_a_picture() {
    let (args, announced) = call(
        &run(),
        json!({"prompt": "", "action": "append", "image": {"id": "forged"}}),
        DOC,
    );
    assert!(!announced);
    assert!(args.get("image").is_none());
    assert!(generate_image_text(&args).starts_with("Not generated"));
}

#[test]
fn a_picture_for_new_text_is_written_into_it_not_asked_for() {
    let run = run();
    let (args, announced) = call(
        &run,
        json!({"prompt": "boats", "alt": "Boats", "action": "in_text"}),
        "",
    );
    assert!(!announced);
    assert!(generate_image_text(&args).contains("Unknown action `in_text`"));
    assert!(description(2).contains("![alt](textus-picture:ASPECT description)"));
}

#[test]
fn a_picture_may_stand_next_to_text_proposed_and_not_decided_yet() {
    let run = run();
    let new = "The tide went out before dawn.\n\nThe boats came back at dusk.";
    let at = |anchor: &str| json!({"prompt": "boats", "alt": "Boats", "action": "insert_after", "anchor": anchor});
    // This request's own proposal, which isn't in the empty document.
    let (args, _) = call_with(&run, at("The boats came back at dusk."), "", &[new], &[]);
    assert!(args.get("image").is_some(), "{args}");
    // An earlier request's, still undecided.
    let (args, _) = call_with(
        &run,
        at("The tide went out before dawn."),
        DOC,
        &[],
        &[UndecidedEdit {
            replaced: String::new(),
            text: new.to_string(),
        }],
    );
    assert!(args.get("image").is_some(), "{args}");
    // Text found nowhere is still refused, and spends nothing.
    let (args, _) = call_with(&run, at("Nowhere at all."), DOC, &[new], &[]);
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("name the passage by its block"));
    assert_eq!(run.made.load(Ordering::SeqCst), 2);
}

#[test]
fn a_picture_not_decided_yet_is_known_with_its_markdown() {
    let call = |id: &str, image: &str| {
        AgentTurn::ToolCall {
            call_id: id.into(),
            name: GENERATE_IMAGE_TOOL_NAME.into(),
            arguments: json!({"prompt": "p", "alt": "Boats", "action": "insert_after", "anchor": "A.", "image": {"id": image, "width": 1, "height": 1}}).to_string(),
            reasoning: None,
        }
    };
    let result = |id: &str, note: &str| AgentTurn::ToolResult {
        call_id: id.into(),
        output: format!("Image proposed. {note}"),
        images: Vec::new(),
    };
    let history = vec![
        call("g1", "open1"),
        result(
            "g1",
            "Status: the user has NOT yet accepted or rejected this proposed edit.",
        ),
        call("g2", "taken"),
        result("g2", "Status: the user accepted this proposed edit."),
    ];
    assert_eq!(undecided_pictures(&history), vec!["open1".to_string()]);
    let text = outcome(&json!({"alt": "Boats", "action": "insert_after", "image": {"id": "open1", "width": 1, "height": 1}}).to_string());
    assert!(text.contains("![Boats](textus-generated:open1)"), "{text}");
}

#[test]
fn an_edit_that_went_into_an_undecided_one_is_read_into_it() {
    let call = |id: &str, args: Value| AgentTurn::ToolCall {
        call_id: id.into(),
        name: "propose_edit".into(),
        arguments: args.to_string(),
        reasoning: None,
    };
    let result = |id: &str, note: &str| AgentTurn::ToolResult {
        call_id: id.into(),
        output: format!("Edit proposed.\n\n[{note}]"),
        images: Vec::new(),
    };
    let pending = "Status: the user has NOT yet accepted or rejected this proposed edit.";
    let joined = "Status: this went into the proposed text it changes or goes next to - that proposal now reads with it, and it is accepted or rejected with that proposal.";
    let history = vec![
        call(
            "a",
            json!({"action": "replace", "anchor": "The old light.", "text": "The lighthouse shone. Gulls cried."}),
        ),
        result("a", pending),
        call("b", json!({"action": "delete", "anchor": " Gulls cried."})),
        result("b", joined),
        call(
            "c",
            json!({"action": "replace", "anchor": "lighthouse", "text": "beacon"}),
        ),
        result("c", joined),
    ];
    assert_eq!(
        undecided_edits(&history),
        vec![UndecidedEdit {
            replaced: "The old light.".into(),
            text: "The beacon shone.".into(),
        }]
    );
}

#[test]
fn undecided_edits_are_read_off_the_status_notes() {
    let call = |id: &str, text: &str| AgentTurn::ToolCall {
        call_id: id.into(),
        name: "propose_edit".into(),
        arguments: json!({"action": "append", "text": text}).to_string(),
        reasoning: None,
    };
    let result = |id: &str, note: &str| AgentTurn::ToolResult {
        call_id: id.into(),
        output: format!("Edit proposed.\n\n[{note}]"),
        images: Vec::new(),
    };
    let history = vec![
            call("a", "Kept."),
            result("a", "Status: the user accepted this proposed edit - the document text in this request includes it."),
            call("b", "Open."),
            result("b", "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview."),
        ];
    assert_eq!(
        undecided_edits(&history),
        vec![UndecidedEdit {
            replaced: String::new(),
            text: "Open.".into()
        }]
    );
}

#[test]
fn a_picture_is_made_while_the_reply_goes_on() {
    let run = run();
    let (args, announced) = call(
        &run,
        json!({"prompt": "boats at dusk", "alt": "Boats", "action": "insert_after", "anchor": "The boats came in at dusk.", "aspect": "16:9"}),
        DOC,
    );
    assert!(announced);
    // Returned at once, with the frame's shape, before any answer.
    let image = &args["image"];
    assert_eq!(image["pending"], true);
    assert_eq!(
        (image["width"].as_u64(), image["height"].as_u64()),
        (Some(1536), Some(1024))
    );
    let text = generate_image_text(&args);
    assert!(text.starts_with("Image proposed and being made"), "{text}");
    assert!(text.contains("don't wait for it"));
    // Nothing answers here: the frame learns why.
    let why = picture(image["id"].as_str().unwrap()).unwrap_err();
    assert!(why.starts_with("Couldn't reach the image service"), "{why}");
}

#[test]
fn the_frame_waits_for_the_picture_and_gets_it() {
    let id = begin();
    assert!(look(&id).is_none());
    let waiting = std::thread::spawn({
        let id = id.clone();
        move || picture(&id)
    });
    std::thread::sleep(std::time::Duration::from_millis(400));
    finish(
        &id,
        Slot::Ready(GeneratedImage {
            bytes: vec![1, 2, 3],
            mime: "image/png",
            ext: "png",
            width: 4,
            height: 3,
        }),
    );
    let data = waiting.join().unwrap().unwrap();
    assert_eq!((data.data_base64.as_str(), data.width), ("AQID", 4));
}

#[test]
fn a_picture_let_go_while_painting_stays_gone() {
    let id = begin();
    ai_discard_generated_image(id.clone());
    finish(&id, Slot::Failed("late".into()));
    assert!(picture(&id).unwrap_err().contains("no longer available"));
}

#[test]
fn a_send_makes_at_most_two_pictures() {
    let run = run();
    let args = json!({"prompt": "nets", "alt": "Nets", "action": "append"});
    for _ in 0..PER_SEND {
        assert!(call(&run, args.clone(), DOC).1);
    }
    let (third, announced) = call(&run, args, DOC);
    assert!(!announced);
    assert!(third["not_generated"]
        .as_str()
        .unwrap()
        .contains("already made 2 pictures"));
}

#[test]
fn a_kept_picture_is_proposed_and_can_be_let_go() {
    let id = begin();
    finish(
        &id,
        Slot::Ready(GeneratedImage {
            bytes: vec![1, 2, 3],
            mime: "image/png",
            ext: "png",
            width: 4,
            height: 3,
        }),
    );
    let data = picture(&id).unwrap();
    assert_eq!(
        (data.mime, data.data_base64.as_str()),
        ("image/png", "AQID")
    );
    let text = generate_image_text(&json!({"image": {"id": id, "width": 4, "height": 3}}));
    assert!(text.starts_with("Image proposed"), "{text}");
    assert!(text.contains("4 x 3 pixels"));
    ai_discard_generated_image(id.clone());
    assert!(picture(&id).is_err());
}

#[test]
fn the_tool_offers_insertions_replacing_a_picture_and_the_five_aspects() {
    let spec = spec(PER_SEND);
    assert_eq!(
        spec.parameters["properties"]["action"]["enum"],
        json!(IMAGE_ACTIONS)
    );
    assert_eq!(
        spec.parameters["properties"]["aspect"]["enum"],
        json!(Aspect::ALL)
    );
}

#[test]
fn a_picture_in_the_document_can_be_redone() {
    let doc = format!("{DOC}\n\n![Boats at dusk](assets/boats.png)");
    let (args, announced) = call(
        &run(),
        json!({"prompt": "the boats at dawn instead", "alt": "Boats at dawn", "action": "replace", "anchor": "![Boats at dusk](assets/boats.png)"}),
        &doc,
    );
    assert!(announced);
    assert_eq!(args["image"]["pending"], true);
    // Only one that is there, and only a whole picture.
    let (args, _) = call(
        &run(),
        json!({"prompt": "x", "action": "replace", "anchor": "![Nets](assets/nets.png)"}),
        &doc,
    );
    assert!(args["not_generated"]
        .as_str()
        .unwrap()
        .contains("name the passage by its block"));
    assert!(is_picture_markdown("![a](b.png)"));
    assert!(is_picture_markdown("![](<my file.png>)"));
    assert!(!is_picture_markdown("![a](b.png) and text"));
    assert!(!is_picture_markdown("The boats came in at dusk."));
}

#[test]
fn the_limit_is_the_setting_within_bounds_and_the_model_is_told_it() {
    assert_eq!(per_send(None), PER_SEND);
    assert_eq!(per_send(Some(4)), 4);
    assert_eq!(per_send(Some(0)), 1);
    assert_eq!(per_send(Some(50)), MAX_PER_SEND);
    let mut run = run();
    run.limit = 3;
    let args = json!({"prompt": "nets", "alt": "Nets", "action": "append"});
    for _ in 0..3 {
        assert!(call(&run, args.clone(), DOC).1);
    }
    let (fourth, _) = call(&run, args, DOC);
    assert!(fourth["not_generated"]
        .as_str()
        .unwrap()
        .contains("already made 3 pictures"));
    assert!(description(3).contains("at most 3"));
}

#[test]
fn the_image_model_follows_the_chat_provider() {
    // OpenAI: the sign-in's pictures while signed in, the key's else.
    assert_eq!(following_chat("openai", true), Some("openai-chatgpt"));
    assert_eq!(following_chat("openai", false), Some("openai"));
    // A provider with pictures of its own, on the same key.
    assert_eq!(following_chat("google", false), Some("google"));
    assert_eq!(following_chat("doubao", true), Some("doubao"));
    // One that makes none, and the compatible endpoint, which is a
    // different server from chat's: no pictures.
    assert_eq!(following_chat("anthropic", false), None);
    assert_eq!(following_chat("deepseek", false), None);
    assert_eq!(following_chat("custom", false), None);
}

#[test]
fn every_built_in_image_provider_has_an_https_address_and_a_default_model() {
    for entry in IMAGE_PROVIDERS {
        if entry.id == "custom" {
            assert!(entry.base_url.is_none() && entry.models.is_empty());
            continue;
        }
        // The sign-in has no address or key, only its one model.
        if entry.api == ImageApi::ChatGpt {
            assert!(entry.base_url.is_none() && entry.key_id.is_empty());
            assert_eq!(entry.models.len(), 1);
            continue;
        }
        assert!(
            entry.base_url.unwrap().starts_with("https://"),
            "{}",
            entry.id
        );
        assert!(!entry.models.is_empty(), "{}", entry.id);
    }
    // A chat provider that makes pictures (the capability table says
    // which, and how) is offered with its own key.
    for chat in crate::ai::catalog::PROVIDER_CATALOG {
        let caps = aicompat::capabilities::provider(chat.id);
        match (caps.image, find(chat.id)) {
            (Some(api), Some(entry)) => {
                assert_eq!(entry.api, api, "{}", chat.id);
                assert_eq!(entry.key_id, chat.id);
            }
            (None, Some(entry)) => assert_eq!(entry.id, "custom"),
            (Some(_), None) => panic!("{} makes pictures but isn't offered", chat.id),
            (None, None) => {}
        }
    }
}

fn generate_image_text(args: &Value) -> String {
    outcome(&args.to_string())
}

#[test]
fn a_redone_picture_is_read_from_the_document_folder() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    // The smallest PNG: its signature is all read_image looks at.
    std::fs::write(dir.path().join("assets/rain.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    let read = |markdown: &str| local_picture(markdown, dir.path()).map(|p| p.mime);
    assert_eq!(
        read("![Rain](assets/rain.png)").as_deref(),
        Some("image/png")
    );
    assert_eq!(
        read("![Rain](<assets/rain.png> \"title\")").as_deref(),
        Some("image/png")
    );
    assert_eq!(
        read("<img src=\"assets/rain.png\" width=\"320\">").as_deref(),
        Some("image/png")
    );
    // On the web, in the text, or not a picture at all: nothing to send.
    assert_eq!(read("![Rain](https://example.com/rain.png)"), None);
    assert_eq!(read("![Rain](../outside.png)"), None);
    assert_eq!(read("Rain on the roof."), None);
}

#[test]
fn a_picture_that_was_not_made_is_asked_for_again_by_itself() {
    // Nothing listens at the offline run's address: each try fails.
    let run = run();
    let (failing, _) = run.start("A red boat".into(), Aspect::Square, None);
    let (other, _) = run.start("A blue boat".into(), Aspect::Square, None);
    assert!(picture(&failing).is_err());
    assert!(picture(&other).is_err());
    ai_retry_generated_image(failing.clone()).expect("asked again");
    // Being made again: retried twice at once, the second is refused.
    assert!(ai_retry_generated_image(failing.clone()).is_err());
    assert!(picture(&failing).is_err());
    // The other picture was left as it was.
    assert!(matches!(look(&other), Some(Err(_))));
    assert!(ai_retry_generated_image("gone00".into()).is_err());
}
