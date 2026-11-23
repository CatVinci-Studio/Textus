//! A refused request's error carries the status and the body as they came:
//! error_kind and the frontend read both out of it.

use super::{custom, openai_responses_compatible};
use crate::capabilities::Thinking;
use crate::images::tests::serve;

/// A server that answers once with 503 and "busy".
fn busy() -> String {
    serve(vec![(503, "text/plain", b"busy".to_vec())]).0
}

async fn answered(base: String) -> reqwest::Response {
    crate::http::client().get(base).send().await.unwrap()
}

fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Runtime::new().unwrap().block_on(f)
}

#[test]
fn a_custom_endpoint_names_the_status_and_body() {
    let base = busy();
    let err = run(custom::agent_step(
        &base,
        None,
        "m",
        "",
        &[],
        &[],
        None,
        custom::Vendor::Generic,
        &Thinking::default(),
        &|_| {},
    ))
    .err()
    .unwrap();
    assert_eq!(
        err,
        "Custom endpoint request failed (503 Service Unavailable): busy"
    );

    let base = busy();
    let err = run(custom::agent_step_streaming(
        &base,
        None,
        "m",
        "",
        &[],
        &[],
        None,
        custom::Vendor::Generic,
        &Thinking::default(),
        false,
        &|_| {},
    ))
    .err()
    .unwrap();
    assert_eq!(
        err,
        "Custom endpoint request failed (503 Service Unavailable): busy"
    );

    let base = busy();
    let err = run(custom::call_completion(
        &base,
        None,
        "m",
        String::new(),
        String::new(),
        custom::Vendor::Generic,
    ))
    .err()
    .unwrap();
    assert_eq!(
        err,
        "Custom endpoint request failed (503 Service Unavailable): busy"
    );
}

#[test]
fn a_responses_endpoint_names_the_status_and_body() {
    let base = busy();
    let err = run(openai_responses_compatible::agent_step(
        &base,
        None,
        "m",
        "",
        &[],
        &[],
        false,
        &Thinking::default(),
        &|_| {},
    ))
    .err()
    .unwrap();
    assert_eq!(
        err,
        "Responses API request failed (503 Service Unavailable): busy"
    );

    let err = run(async {
        crate::responses_api::extract_response_text(answered(busy()).await, "OpenAI").await
    })
    .err()
    .unwrap();
    assert_eq!(err, "OpenAI request failed (503 Service Unavailable): busy");
}

#[test]
fn a_stream_names_the_status_and_body() {
    let err = run(async { crate::http::read_sse(answered(busy()).await, "Claude", |_| {}).await })
        .err()
        .unwrap();
    assert_eq!(err, "Claude request failed (503 Service Unavailable): busy");
}

/// The token exchanges post to fixed addresses, so only the shape they share
/// is checked here.
#[test]
fn a_token_exchange_names_the_status_and_body() {
    let err =
        run(async { crate::http::succeeded(answered(busy()).await, "token refresh failed").await })
            .err()
            .unwrap();
    assert_eq!(err, "token refresh failed (503 Service Unavailable): busy");
}
