use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;

fn call(id: &str, name: &str, arguments: &str) -> AgentTurn {
    AgentTurn::ToolCall {
        call_id: id.into(),
        name: name.into(),
        arguments: arguments.into(),
        reasoning: None,
    }
}

fn user(text: &str) -> AgentTurn {
    AgentTurn::User {
        text: text.into(),
        images: Vec::new(),
    }
}

/// Drives the loop with a scripted "model": each step pops the next
/// response, and records the history it was shown.
fn run_scripted<R: Into<ToolOutput>>(
    script: Vec<StepResult>,
    max_steps: usize,
    execute: impl Fn(&str, &str) -> R,
) -> (Vec<AgentTurn>, Vec<Vec<AgentTurn>>) {
    let script = RefCell::new(VecDeque::from(script));
    let seen = RefCell::new(Vec::new());
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        max_steps,
        |history| {
            seen.borrow_mut().push(history);
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |call: ToolCall| std::future::ready(execute(&call.name, &call.arguments)),
        |_| ToolRun::InOrder,
        |_| {},
    ))
    .unwrap();
    (turns, seen.into_inner())
}

#[test]
fn citation_markers_are_swapped_or_dropped() {
    let text = format!("A{}B{}C", citation_marker(1), citation_marker(2));
    assert_eq!(
        replace_citation_markers(&text, |k| (k == 1).then(|| "[7]".to_string())),
        "A[7]BC"
    );
    assert_eq!(replace_citation_markers("plain [1]", |_| None), "plain [1]");
}

#[test]
fn a_span_that_does_not_fit_the_text_is_still_cited_at_the_end() {
    let mut citations = StepCitations::default();
    let text = mark_cited_spans(
        "Short.",
        vec![CitedSpan {
            start: 40,
            end: 50,
            url: "https://a.example/",
            title: "",
        }],
        &mut citations,
        &|_| {},
    );
    assert_eq!(text, format!("Short.{}", citation_marker(1)));
}

#[test]
fn tool_results_are_fed_back_before_the_final_answer() {
    let (turns, seen) = run_scripted(
        vec![
            StepResult::ToolCalls(vec![call("1", "search_document", r#"{"query":"x"}"#)]),
            StepResult::Done("found it".into()),
        ],
        12,
        |name, _| format!("ran {name}"),
    );
    assert_eq!(turns.len(), 4); // user, call, result, answer
    assert!(
        matches!(&turns[2], AgentTurn::ToolResult { output, .. } if output == "ran search_document")
    );
    assert!(matches!(&turns[3], AgentTurn::Assistant { text, .. } if text == "found it"));
    // The second step saw the call and its result.
    assert_eq!(seen[1].len(), 3);
}

/// A step's calls come first, then their results in the same order, so
/// a call after a result marks the next step - what the providers group
/// assistant messages by.
#[test]
fn each_step_records_its_calls_then_their_results() {
    let (turns, seen) = run_scripted(
        vec![
            StepResult::ToolCalls(vec![call("a", "t1", "{}"), call("b", "t2", "{}")]),
            StepResult::ToolCalls(vec![call("c", "t3", "{}")]),
            StepResult::Done(String::new()),
        ],
        12,
        |name, _| name.to_string(),
    );
    let ids: Vec<_> = turns
        .iter()
        .filter_map(|t| match t {
            AgentTurn::ToolCall { call_id, .. } => Some(format!("call:{call_id}")),
            AgentTurn::ToolResult { call_id, .. } => Some(format!("result:{call_id}")),
            _ => None,
        })
        .collect();
    assert_eq!(
        ids,
        ["call:a", "call:b", "result:a", "result:b", "call:c", "result:c"]
    );
    // Each step is shown the one before it plus what it added - the
    // earlier turns never change, which is what keeps the prefix cached.
    assert_eq!(seen[2].len(), seen[1].len() + 2);
    assert_eq!(
        format!("{:?}", &seen[2][..seen[1].len()]),
        format!("{:?}", seen[1])
    );
}

#[test]
fn a_tools_images_land_in_its_result_turn() {
    let (turns, _) = run_scripted(
        vec![
            StepResult::ToolCalls(vec![call("v", "view_image", "{}")]),
            StepResult::Done(String::new()),
        ],
        12,
        |_, _| ToolOutput {
            text: "Here is map.png.".into(),
            images: vec![ImageAttachment {
                name: "map.png".into(),
                mime: "image/png".into(),
                data_base64: "AAAA".into(),
            }],
            ..ToolOutput::default()
        },
    );
    let AgentTurn::ToolResult { output, images, .. } = &turns[2] else {
        panic!("the call's result follows it");
    };
    assert_eq!(output, "Here is map.png.");
    assert_eq!(images[0].name, "map.png");
}

#[test]
fn running_out_of_steps_still_ends_with_a_reply() {
    let looping = (0..3)
        .map(|i| StepResult::ToolCalls(vec![call(&i.to_string(), "search_document", "{}")]))
        .collect();
    let (turns, _) = run_scripted(looping, 3, |_, _| "nothing".to_string());
    let AgentTurn::Assistant { text, .. } = turns.last().unwrap() else {
        panic!("the exchange must end with an assistant turn");
    };
    assert_eq!(text, OUT_OF_STEPS);
}

#[test]
fn the_chat_knows_the_out_of_steps_reply() {
    let ts = include_str!("../../../../../src/ai/chat/out-of-steps.ts");
    assert!(ts.contains(&format!("\"{OUT_OF_STEPS}\"")));
}

#[test]
fn the_last_steps_are_announced_to_the_model_only() {
    let looping = (0..4)
        .map(|i| StepResult::ToolCalls(vec![call(&i.to_string(), "measure_text", "{}")]))
        .collect();
    let (turns, seen) = run_scripted(looping, 4, |_, _| "12 chars".to_string());
    let noted = |history: &[AgentTurn]| {
        history.iter().any(|t| {
                matches!(t, AgentTurn::ToolResult { output, .. } if output.contains("left in this request"))
            })
    };
    // The second step is told nothing; the third sees the two steps
    // still to come, the last that it is the last.
    assert!(!noted(&seen[1]));
    assert!(matches!(
        seen[2].last(),
        Some(AgentTurn::ToolResult { output, .. })
            if output.starts_with("12 chars") && output.contains("Only 2 steps left")
    ));
    assert!(matches!(
        seen[3].last(),
        Some(AgentTurn::ToolResult { output, .. }) if output.contains("Only 1 step left")
    ));
    // Earlier turns are shown as they were first sent.
    assert_eq!(
        format!("{:?}", &seen[3][..seen[2].len()]),
        format!("{:?}", seen[2])
    );
    // What is recorded (and shown to the user) carries no note.
    assert!(!noted(&turns));
}

/// Runs the loop on `script`, returning the turns and how many times
/// it reported a retry.
fn run_counting_retries(script: Vec<StepResult>) -> (Vec<AgentTurn>, usize) {
    let script = RefCell::new(VecDeque::from(script));
    let retries = RefCell::new(0);
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |call: ToolCall| std::future::ready(call.name),
        |_| ToolRun::InOrder,
        |event| {
            if let LoopEvent::Retry = event {
                *retries.borrow_mut() += 1;
            }
        },
    ))
    .unwrap();
    (turns, retries.into_inner())
}

#[test]
fn a_garbled_step_is_asked_for_again_once() {
    let edit = |text: &str| {
        StepResult::ToolCalls(vec![call(
            "e",
            "propose_edit",
            &format!(r#"{{"action":"append","text":"{text}"}}"#),
        )])
    };
    let (turns, retries) = run_counting_retries(vec![
        edit("《百年孤\u{FFFD}\u{FFFD}\u{FFFD}》"),
        edit("《百年孤独》"),
        StepResult::Done("《百年孤\u{FFFD}》".into()),
    ]);
    assert_eq!(retries, 1);
    // The garbled call never ran; the one sent again did.
    let AgentTurn::ToolCall { arguments, .. } = &turns[1] else {
        panic!("the call follows the user turn");
    };
    assert!(arguments.contains("《百年孤独》"));
    // Once per request: a later garbled reply stands.
    assert!(
        matches!(turns.last(), Some(AgentTurn::Assistant { text, .. }) if text.contains('\u{FFFD}'))
    );
}

#[test]
fn a_garbled_reply_is_asked_for_again() {
    let (turns, retries) = run_counting_retries(vec![
        StepResult::Done("《百年孤\u{FFFD}》".into()),
        StepResult::Done("《百年孤独》".into()),
    ]);
    assert_eq!(retries, 1);
    assert!(matches!(&turns[1], AgentTurn::Assistant { text, .. } if text == "《百年孤独》"));
    // An escaped replacement character in tool arguments counts too.
    let escaped = StepResult::ToolCalls(vec![call("e", "propose_edit", r#"{"text":"\ufffd"}"#)]);
    assert!(garbled(&escaped));
    assert!(!garbled(&StepResult::Done("《百年孤独》".into())));
}

/// A read that finishes only after the next one has: run one call at a
/// time it gives up (and says so) instead of waiting forever.
fn waits_for(
    flag: &std::sync::atomic::AtomicBool,
) -> impl std::future::Future<Output = String> + '_ {
    let mut polls = 0;
    std::future::poll_fn(move |cx| {
        if flag.load(std::sync::atomic::Ordering::SeqCst) {
            return std::task::Poll::Ready("slow".to_string());
        }
        polls += 1;
        if polls > 1_000 {
            return std::task::Poll::Ready("ran alone".to_string());
        }
        cx.waker().wake_by_ref();
        std::task::Poll::Pending
    })
}

fn results(turns: &[AgentTurn]) -> Vec<(String, String)> {
    turns
        .iter()
        .filter_map(|t| match t {
            AgentTurn::ToolResult {
                call_id, output, ..
            } => Some((call_id.clone(), output.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn reads_in_one_step_run_together_and_are_recorded_in_call_order() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let fast_done = AtomicBool::new(false);
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::ToolCalls(vec![
            call("1", "web_fetch", "slow"),
            call("2", "web_fetch", "fast"),
        ]),
        StepResult::Done(String::new()),
    ]));
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |call: ToolCall| {
            let fast_done = &fast_done;
            async move {
                if call.arguments == "fast" {
                    fast_done.store(true, Ordering::SeqCst);
                    "fast".to_string()
                } else {
                    waits_for(fast_done).await
                }
            }
        },
        |_| ToolRun::Concurrent,
        |_| {},
    ))
    .unwrap();
    assert_eq!(
        results(&turns),
        [("1".into(), "slow".into()), ("2".into(), "fast".into())]
    );
}

#[test]
fn a_proposal_waits_for_the_reads_before_it() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let read_done = AtomicBool::new(false);
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::ToolCalls(vec![
            call("r", "read_document", "{}"),
            call("p", "propose_edit", "{}"),
        ]),
        StepResult::Done(String::new()),
    ]));
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |call: ToolCall| {
            let read_done = &read_done;
            async move {
                if call.name == "read_document" {
                    read_done.store(true, Ordering::SeqCst);
                    "read".to_string()
                } else if read_done.load(Ordering::SeqCst) {
                    "proposed after the read".to_string()
                } else {
                    "proposed first".to_string()
                }
            }
        },
        |name| match name {
            "propose_edit" => ToolRun::InOrder,
            _ => ToolRun::Concurrent,
        },
        |_| {},
    ))
    .unwrap();
    assert_eq!(results(&turns)[1].1, "proposed after the read");
}

/// Runs a step of one propose_edit call, with `text` beside it, whose
/// output is `settled` or not, then (if asked) a closing reply.
fn propose_then(text: &str, settled: bool) -> (Vec<AgentTurn>, usize) {
    let steps = RefCell::new(0);
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::calls_with_text(vec![call("p", "propose_edit", "{}")], text.to_string()),
        StepResult::Done("asked again".into()),
    ]));
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            *steps.borrow_mut() += 1;
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |_| {
            std::future::ready(ToolOutput {
                text: "Edit proposed".into(),
                settled,
                ..ToolOutput::default()
            })
        },
        |_| ToolRun::InOrder,
        |_| {},
    ))
    .unwrap();
    (turns, steps.into_inner())
}

fn reply_of(turns: &[AgentTurn]) -> &str {
    match turns.last() {
        Some(AgentTurn::Assistant { text, .. }) => text,
        other => panic!("no reply: {other:?}"),
    }
}

#[test]
fn a_settled_proposal_with_its_reply_ends_the_exchange() {
    let (turns, steps) = propose_then("Tightened the opening.", true);
    assert_eq!(steps, 1, "no request just for the closing sentence");
    assert_eq!(reply_of(&turns), "Tightened the opening.");
    // user, call, result, reply - the reply after the result, as before.
    assert!(matches!(turns[2], AgentTurn::ToolResult { .. }));
}

/// Runs a step of `calls` settled comments, with text beside it, then a
/// closing reply: how many steps it took.
fn comments_then(calls: usize) -> usize {
    let steps = RefCell::new(0);
    let step: Vec<AgentTurn> = (0..calls)
        .map(|i| call(&format!("c{i}"), "add_comment", "{}"))
        .collect();
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::calls_with_text(step, "Glossed the hard words.".to_string()),
        StepResult::Done("and the rest".into()),
    ]));
    tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            *steps.borrow_mut() += 1;
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |_| {
            std::future::ready(ToolOutput {
                text: "Comment added".into(),
                settled: true,
                settles_with_others: true,
                ..ToolOutput::default()
            })
        },
        |_| ToolRun::InOrder,
        |_| {},
    ))
    .unwrap();
    steps.into_inner()
}

#[test]
fn a_comment_pinned_alone_goes_on_one_more_step_and_several_end_there() {
    assert_eq!(comments_then(1), 2);
    assert_eq!(comments_then(3), 1);
}

#[test]
fn without_a_reply_or_a_settled_call_the_model_is_asked_again() {
    let (turns, steps) = propose_then("", true);
    assert_eq!((steps, reply_of(&turns)), (2, "asked again"));
    // A refused proposal: the model must see why, so the text it wrote
    // before knowing is dropped.
    let (turns, steps) = propose_then("Tightened the opening.", false);
    assert_eq!((steps, reply_of(&turns)), (2, "asked again"));
}

/// generate_image's call is recorded, and reported, with the picture
/// its run made - after it ran.
#[test]
fn an_amending_tool_rewrites_its_call_before_it_is_reported() {
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::ToolCalls(vec![call("i", "generate_image", r#"{"prompt":"a cat"}"#)]),
        StepResult::Done(String::new()),
    ]));
    let reported = RefCell::new(Vec::new());
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| {
            let next = script.borrow_mut().pop_front();
            async move { next.ok_or_else(|| "script ran out".to_string()) }
        },
        |_| {
            std::future::ready(ToolOutput {
                text: "Image proposed".into(),
                call_arguments: Some(r#"{"prompt":"a cat","image":{"id":"x"}}"#.into()),
                ..ToolOutput::default()
            })
        },
        |_| ToolRun::Amending,
        |event| {
            if let LoopEvent::Turn(turn) = event {
                reported.borrow_mut().push(format!("{turn:?}"));
            }
        },
    ))
    .unwrap();
    let AgentTurn::ToolCall { arguments, .. } = &turns[1] else {
        panic!("the call follows the user turn");
    };
    assert!(arguments.contains(r#""id":"x""#));
    let reported = reported.into_inner();
    assert_eq!(reported.len(), 2, "the call, then its result");
    assert!(reported[0].contains("ToolCall") && reported[0].contains(r#"\"id\":\"x\""#));
}

#[test]
fn openai_style_usage_reads_the_cached_part_out_of_the_input() {
    let chat = serde_json::json!({
        "prompt_tokens": 6461,
        "completion_tokens": 40,
        "prompt_tokens_details": {"cached_tokens": 5944}
    });
    assert_eq!(
        StepUsage::from_openai(&chat),
        Some(StepUsage {
            input_tokens: 517,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 5944,
            output_tokens: 40,
        })
    );
    let responses = serde_json::json!({
        "input_tokens": 1200,
        "input_tokens_details": {"cached_tokens": 1024},
        "output_tokens": 9
    });
    assert_eq!(
        StepUsage::from_openai(&responses).map(|u| (u.input_tokens, u.cache_read_input_tokens)),
        Some((176, 1024))
    );
    let deepseek = serde_json::json!({
        "prompt_tokens": 100, "completion_tokens": 5, "prompt_cache_hit_tokens": 64
    });
    assert_eq!(
        StepUsage::from_openai(&deepseek).map(|u| u.cache_read_input_tokens),
        Some(64)
    );
    let kimi =
        serde_json::json!({"prompt_tokens": 100, "completion_tokens": 5, "cached_tokens": 80});
    assert_eq!(
        StepUsage::from_openai(&kimi).map(|u| u.input_tokens),
        Some(20)
    );
    assert_eq!(StepUsage::from_openai(&serde_json::Value::Null), None);
}

#[test]
fn a_step_error_aborts_the_exchange() {
    let result = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        user("go"),
        12,
        |_| async { Err::<StepResult, _>("429 rate limited".to_string()) },
        |_| std::future::ready(String::new()),
        |_| ToolRun::InOrder,
        |_| {},
    ));
    assert_eq!(result.unwrap_err(), "429 rate limited");
}
