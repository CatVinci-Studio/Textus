
use super::*;
use std::io::{Read, Write};

/// Answers one request on a local port with a JSON `body` and the
/// HTTP `status`, and hands back the request it got.
fn serve(status: &'static str, body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/search", listener.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buf = [0u8; 4096];
        // Headers, then as much body as Content-Length says.
        loop {
            let n = stream.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&request).to_string();
            if let Some(end) = text.find("\r\n\r\n") {
                let length = text
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let _ = tx.send(String::from_utf8_lossy(&request).into_owned());
        let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        let _ = stream.write_all(response.as_bytes());
    });
    (url, rx)
}

async fn run(
    backend: Backend,
    status: &'static str,
    body: &'static str,
) -> (Result<Vec<Hit>, String>, String) {
    let (url, requests) = serve(status, body);
    let service = Service {
        backend,
        credential: "test-key".into(),
        endpoint: Some(url),
    };
    let hits = service
        .search("tide tables", 8, "When are spring tides?")
        .await;
    (hits, requests.recv().unwrap())
}

#[tokio::test]
async fn deepseek_sends_the_key_and_the_question_and_reads_results() {
    let (hits, request) = run(
            Backend::Deepseek,
            "200 OK",
            r#"{"results":[{"title":"Tides","url":"https://sea.example/tides","snippet":"Twice a day.","summary":"long","site_name":"Sea","date":"2026-02-02T16:00:00+00:00"}]}"#,
        )
        .await;
    assert!(request.starts_with("POST /search "), "{request}");
    assert!(
        request.contains("authorization: Bearer test-key"),
        "{request}"
    );
    assert!(
        request.contains(r#""ori_question":"When are spring tides?""#),
        "{request}"
    );
    assert_eq!(
        hits.unwrap(),
        vec![Hit {
            title: "Tides".into(),
            url: "https://sea.example/tides".into(),
            snippet: "Twice a day.".into(),
            date: Some("2026-02-02T16:00:00+00:00".into()),
            site: Some("Sea".into()),
        }]
    );
}

#[tokio::test]
async fn deepseek_cuts_a_long_query_and_leaves_out_an_empty_question() {
    let (url, requests) = serve("200 OK", r#"{"results":[]}"#);
    let service = Service {
        backend: Backend::Deepseek,
        credential: "test-key".into(),
        endpoint: Some(url),
    };
    service.search(&"潮".repeat(200), 8, "  ").await.unwrap();
    let request = requests.recv().unwrap();
    let (_, body) = request.split_once("\r\n\r\n").unwrap();
    let body: Value = serde_json::from_str(body).unwrap();
    assert_eq!(body["query"], "潮".repeat(128));
    assert!(body.get("ori_question").is_none(), "{body}");
}

/// The shape api.deepseek.com/v1/tools/fetch really answers in: every
/// punctuation mark escaped, code included.
#[tokio::test]
async fn deepseek_fetch_reads_the_page_without_its_escapes() {
    let (url, requests) = serve(
        "200 OK",
        r#"{"title":"Rust Blog","content":"\\#\\# Posts\n\nOct\\. 15 \\| Announcing Rust 1\\.99\\.1\nfn main\\(\\) \\{ \\}\nC:\\\\Users\\Ada"}"#,
    );
    let service = Service {
        backend: Backend::Deepseek,
        credential: "test-key".into(),
        endpoint: Some(url),
    };
    let (title, page) = service
        .fetch_page("https://blog.rust-lang.org/")
        .await
        .unwrap()
        .unwrap();
    let request = requests.recv().unwrap();
    assert!(request.starts_with("POST /search/fetch "), "{request}");
    assert!(
        request.contains(r#"{"url":"https://blog.rust-lang.org/"}"#),
        "{request}"
    );
    assert_eq!(title, "Rust Blog");
    assert_eq!(
        page,
        "## Posts\n\nOct. 15 | Announcing Rust 1.99.1\nfn main() { }\nC:\\Users\\Ada"
    );
}

#[tokio::test]
async fn zhipu_reads_search_result_and_reports_its_errors() {
    let (hits, request) = run(
            Backend::Zhipu,
            "200 OK",
            r#"{"search_result":[{"title":"潮汐","link":"https://sea.example/cn","content":"每天两次。","media":"海洋网","publish_date":"2026-01-01","refer":"ref_1"}]}"#,
        )
        .await;
    assert!(
        request.contains(r#""search_query":"tide tables""#),
        "{request}"
    );
    assert!(
        request.contains(r#""search_engine":"search_std""#),
        "{request}"
    );
    let hits = hits.unwrap();
    assert_eq!(hits[0].url, "https://sea.example/cn");
    assert_eq!(hits[0].site.as_deref(), Some("海洋网"));

    let (err, _) = run(
        Backend::Zhipu,
        "200 OK",
        r#"{"error":{"code":"1701","message":"too many requests"}}"#,
    )
    .await;
    assert!(err.unwrap_err().contains("too many requests"));
}

#[tokio::test]
async fn kimi_reads_search_results() {
    let (hits, request) = run(
            Backend::Kimi,
            "200 OK",
            r#"{"search_results":[{"title":"Tides","url":"https://sea.example/k","site_name":"Sea","date":"2026-03-01","snippet":"","chunks":[{"text":"From the chunk.","score":0.9}]}]}"#,
        )
        .await;
    assert!(
        request.contains(r#""text_query":"tide tables""#),
        "{request}"
    );
    assert_eq!(hits.unwrap()[0].snippet, "From the chunk.");
}

#[tokio::test]
async fn bocha_reads_the_wrapped_answer_and_its_failures() {
    let (hits, request) = run(
            Backend::Bocha,
            "200 OK",
            r#"{"code":200,"msg":null,"data":{"webPages":{"value":[{"name":"潮汐表","url":"https://sea.example/b","snippet":"查询潮汐。","siteName":"海洋","datePublished":"2026-04-01T08:00:00+08:00"}]}}}"#,
        )
        .await;
    assert!(
        request.contains("authorization: Bearer test-key"),
        "{request}"
    );
    assert_eq!(hits.unwrap()[0].title, "潮汐表");

    let (err, _) = run(Backend::Bocha, "200 OK", r#"{"code":403,"msg":"余额不足"}"#).await;
    assert!(err.unwrap_err().contains("余额不足"));
}

#[tokio::test]
async fn tavily_uses_a_bearer_key_and_reads_results() {
    let (hits, request) = run(
            Backend::Tavily,
            "200 OK",
            r#"{"query":"tide tables","results":[{"title":"Tides","url":"https://sea.example/t","content":"Snippet.","score":0.8}]}"#,
        )
        .await;
    assert!(
        request.contains("authorization: Bearer test-key"),
        "{request}"
    );
    assert!(request.contains(r#""max_results":8"#), "{request}");
    assert_eq!(hits.unwrap()[0].snippet, "Snippet.");
}

#[tokio::test]
async fn brave_sends_its_token_header_and_drops_markup() {
    let (hits, request) = run(
            Backend::Brave,
            "200 OK",
            r#"{"web":{"results":[{"title":"<strong>Tide</strong> tables","url":"https://sea.example/br","description":"When the <strong>tide</strong> turns &amp; why.","page_age":"2026-05-01","profile":{"name":"Sea"}}]}}"#,
        )
        .await;
    assert!(
        request.starts_with("GET /search?q=tide+tables&count=8 "),
        "{request}"
    );
    assert!(
        request.contains("x-subscription-token: test-key"),
        "{request}"
    );
    let hit = &hits.unwrap()[0];
    assert_eq!(hit.title, "Tide tables");
    assert_eq!(hit.snippet, "When the tide turns & why.");
}

#[tokio::test]
async fn exa_sends_its_key_header_and_reads_highlights() {
    let (hits, request) = run(
            Backend::Exa,
            "200 OK",
            r#"{"results":[{"title":"Tides","url":"https://sea.example/e","publishedDate":"2026-01-01","highlights":["One.","Two."]}]}"#,
        )
        .await;
    assert!(request.contains("x-api-key: test-key"), "{request}");
    assert_eq!(hits.unwrap()[0].snippet, "One. … Two.");
}

#[tokio::test]
async fn searxng_asks_for_json_and_explains_a_403() {
    let (hits, request) = run(
            Backend::Searxng,
            "200 OK",
            r#"{"query":"tide tables","results":[{"title":"Tides","url":"https://sea.example/s","content":"From SearXNG.","engine":"duckduckgo"},{"title":"No link","url":"","content":""}]}"#,
        )
        .await;
    assert!(
        request.starts_with("GET /search?q=tide+tables&format=json "),
        "{request}"
    );
    assert_eq!(hits.unwrap().len(), 1, "a result without a link is dropped");

    let (err, _) = run(Backend::Searxng, "403 Forbidden", "").await;
    assert!(err.unwrap_err().contains("search.formats"));
}

#[tokio::test]
async fn a_refused_key_says_where_to_fix_it() {
    let (err, _) = run(
        Backend::Tavily,
        "401 Unauthorized",
        r#"{"detail":"bad key"}"#,
    )
    .await;
    let err = err.unwrap_err();
    assert!(err.contains("Tavily refused the key"), "{err}");
    assert!(err.contains("Search service"), "{err}");
}

#[test]
fn ids_round_trip_and_keys_are_shared_where_the_provider_is_the_same() {
    for backend in [
        Backend::Deepseek,
        Backend::Zhipu,
        Backend::Kimi,
        Backend::Bocha,
        Backend::Tavily,
        Backend::Brave,
        Backend::Exa,
        Backend::Searxng,
    ] {
        let id = serde_json::to_value(backend).unwrap();
        assert_eq!(Backend::from_id(id.as_str().unwrap()), Some(backend));
    }
    assert_eq!(Backend::Deepseek.key_id(), Some("deepseek"));
    assert_eq!(Backend::Kimi.key_id(), Some("moonshot"));
    assert_eq!(Backend::Tavily.key_id(), Some("search-tavily"));
    assert_eq!(Backend::from_id("auto"), None);
}
