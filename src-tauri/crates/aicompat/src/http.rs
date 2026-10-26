//! Shared HTTP client construction for every provider request.
//!
//! Some users (notably behind restrictive networks) can only reach the AI
//! providers through a proxy, and a GUI app launched from Finder doesn't
//! inherit shell env vars like HTTPS_PROXY - so the proxy is an explicit,
//! app-level setting mirrored here from the frontend. HTTPS itself needs no
//! setting: every request already goes over TLS (rustls).

use std::sync::RwLock;
use std::time::Duration;

static PROXY_URL: RwLock<Option<String>> = RwLock::new(None);

/// Total request timeout (connect + send + receive the full response).
/// Previously unset entirely, so a provider that stopped responding mid-way
/// because of a dead proxy or a hung custom endpoint could hold the request
/// forever, leaving the frontend no recovery short of restarting the app.
///
/// 120s comfortably covers a slow model's full response for the
/// whole-body paths (completion, grammar, model lists). Streamed agent
/// requests use `streaming_client()` instead - a healthy stream can easily
/// outlive a total cap, so it trades this for a per-read idle timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Max silence between two chunks of a streamed body before giving up -
/// generous enough for a model thinking between tokens, short enough that
/// a dead proxy doesn't hold a request forever.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(120);
/// Max time a stream may go without a single event: bytes alone - an SSE
/// comment, a keep-alive ping - don't count, so a provider that keeps the
/// connection warm while the model has stopped can't hold a request
/// forever, as it did with the ChatGPT model (1.2.0-rc.5). Well past the
/// longest thinking a reply needs.
const STREAM_EVENT_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(300)
};

/// Sets (or clears, with None/empty) the proxy all provider requests route
/// through. Accepts whatever `reqwest::Proxy::all` does - http://, https://,
/// and socks5:// / socks5h:// URLs - and rejects unparseable ones so a typo
/// fails here, visibly, instead of silently at request time.
pub fn set_proxy(url: Option<String>) -> Result<(), String> {
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    if let Some(u) = &url {
        reqwest::Proxy::all(u.clone()).map_err(|e| format!("invalid proxy URL: {e}"))?;
    }
    *PROXY_URL.write().unwrap() = url;
    Ok(())
}

/// The proxy set with [`set_proxy`], for requests that build their own
/// client (the main crate's web_fetch, which pins addresses and handles
/// redirects itself).
pub fn proxy_url() -> Option<String> {
    PROXY_URL.read().unwrap().clone()
}

fn builder() -> reqwest::ClientBuilder {
    with_timeouts(reqwest::Client::builder())
}

fn streaming_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(STREAM_READ_TIMEOUT)
}

fn with_proxy(build: impl Fn() -> reqwest::ClientBuilder) -> reqwest::Client {
    proxy()
        .and_then(|p| build().proxy(p).build().ok())
        .or_else(|| build().build().ok())
        .unwrap_or_default()
}

/// The client every whole-body provider request uses: plain by default, or
/// routed through the configured proxy. Falls back to a direct (still
/// timed-out) client if the stored proxy somehow fails to build - a broken
/// proxy setting shouldn't make the app's AI features unreachable in both
/// directions.
pub(crate) fn client() -> reqwest::Client {
    with_proxy(builder)
}

/// The client for SSE-streamed agent requests: same proxy handling, but no
/// total timeout (a long healthy stream must not be cut off mid-answer) -
/// only the per-read idle timeout guards against a hung connection.
pub(crate) fn streaming_client() -> reqwest::Client {
    with_proxy(streaming_builder)
}

/// The configured proxy, for a client that sets up the rest itself.
pub(crate) fn proxy() -> Option<reqwest::Proxy> {
    PROXY_URL
        .read()
        .unwrap()
        .clone()
        .and_then(|u| reqwest::Proxy::all(u).ok())
}

/// `builder` with the whole-body request timeouts.
pub(crate) fn with_timeouts(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
}

/// A whole-body client for one slow request - an image takes a model a
/// minute or two to make, where the usual cap is for text.
pub(crate) fn long_client(timeout: Duration) -> reqwest::Client {
    let builder = || {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(timeout)
    };
    with_proxy(builder)
}

/// Reassembles `data:` payload lines from raw SSE body chunks, whose
/// boundaries can land anywhere - mid-line, even mid-way through a
/// multi-byte UTF-8 character - so bytes are buffered and only complete
/// lines (which SSE guarantees are whole UTF-8 units) get decoded.
#[derive(Default)]
struct SseLineBuffer {
    buf: Vec<u8>,
}

impl SseLineBuffer {
    /// Calls `on_data` with each complete payload; true once one of them
    /// ended the stream (see [`ends_stream`]).
    fn push(&mut self, chunk: &[u8], mut on_data: impl FnMut(&str)) -> bool {
        self.buf.extend_from_slice(chunk);
        while let Some(newline) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\n', '\r']);
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.strip_prefix(' ').unwrap_or(data);
                on_data(data);
                if ends_stream(data) {
                    return true;
                }
            }
        }
        false
    }
}

/// Whether `data` is the payload that ends a stream in one of the
/// dialects: Chat Completions' `[DONE]`, Anthropic's `message_stop`, the
/// Responses API's `response.completed`/`failed`/`incomplete`. Nothing
/// that matters comes after it, and a server that kept the connection open
/// past it held the request until the read timed out.
fn ends_stream(data: &str) -> bool {
    if data.trim() == "[DONE]" {
        return true;
    }
    // Cheap test before a parse: only these events end a stream.
    if !data.contains("message_stop") && !data.contains("\"response.") {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(data).is_ok_and(|event| {
        matches!(
            event.get("type").and_then(|t| t.as_str()),
            Some("message_stop" | "response.completed" | "response.failed" | "response.incomplete")
        )
    })
}

/// Incrementally consumes an SSE response body, calling `on_data` with each
/// complete `data:` payload as it arrives off the wire. Returns the error
/// body as Err when the response status isn't a success. Shared by every
/// streaming dialect - they differ only in how they interpret payloads.
pub(crate) async fn read_sse(
    res: reqwest::Response,
    provider_label: &str,
    mut on_data: impl FnMut(&str),
) -> Result<(), String> {
    use futures_util::StreamExt;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "{provider_label} request failed ({status}): {text}"
        ));
    }

    let mut stream = res.bytes_stream();
    let mut lines = SseLineBuffer::default();
    let mut last_event = std::time::Instant::now();
    loop {
        let left = STREAM_EVENT_TIMEOUT.saturating_sub(last_event.elapsed());
        let Ok(next) = tokio::time::timeout(left, stream.next()).await else {
            return Err(format!(
                "{provider_label} stopped responding: nothing came for {} minutes",
                STREAM_EVENT_TIMEOUT.as_secs() / 60
            ));
        };
        let Some(chunk) = next else {
            return Ok(());
        };
        let chunk = chunk.map_err(|e| format!("{provider_label} stream failed: {e}"))?;
        let mut events = false;
        let ended = lines.push(&chunk, |data| {
            events = true;
            on_data(data);
        });
        if events {
            last_event = std::time::Instant::now();
        }
        if ended {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(buffer: &mut SseLineBuffer, chunk: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        buffer.push(chunk, |data| out.push(data.to_string()));
        out
    }

    #[test]
    fn the_events_that_end_a_stream_are_known() {
        assert!(ends_stream("[DONE]"));
        assert!(ends_stream(r#"{"type":"message_stop"}"#));
        assert!(ends_stream(
            r#"{"type":"response.completed","response":{}}"#
        ));
        assert!(ends_stream(r#"{"type":"response.incomplete"}"#));
        assert!(!ends_stream(
            r#"{"type":"response.output_text.delta","delta":"message_stop"}"#
        ));
        assert!(!ends_stream(r#"{"type":"content_block_delta"}"#));
    }

    /// A server that writes `body` and then keeps the connection open,
    /// sending only keep-alive comments: what a stream that has ended, or
    /// a model that has stopped, looks like from here.
    fn lingering_server(body: &'static str) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = socket.read(&mut request);
            let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n";
            let _ = socket.write_all(format!("{head}{body}").as_bytes());
            for _ in 0..50 {
                std::thread::sleep(Duration::from_millis(100));
                if socket.write_all(b": keep-alive\n\n").is_err() {
                    break;
                }
            }
        });
        format!("http://{addr}/")
    }

    #[test]
    fn a_stream_ends_at_its_last_event_though_the_connection_stays_open() {
        let url = lingering_server(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{}}\n\n",
        );
        let started = std::time::Instant::now();
        let mut seen = Vec::new();
        let result = crate::block_on(async {
            let res = reqwest::get(&url).await.unwrap();
            read_sse(res, "Test", |data| seen.push(data.to_string())).await
        });
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(seen.len(), 2);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_stream_that_sends_only_keep_alives_gives_up() {
        let url = lingering_server("data: {\"type\":\"response.created\"}\n\n");
        let result = crate::block_on(async {
            let res = reqwest::get(&url).await.unwrap();
            read_sse(res, "Test", |_| {}).await
        });
        assert!(result.unwrap_err().contains("stopped responding"));
    }

    #[test]
    fn emits_each_data_line_and_ignores_other_fields() {
        let mut buffer = SseLineBuffer::default();
        let got = collect(
            &mut buffer,
            b"event: message\ndata: {\"a\":1}\n\ndata:{\"b\":2}\n",
        );
        assert_eq!(got, vec!["{\"a\":1}", "{\"b\":2}"]);
    }

    #[test]
    fn reassembles_lines_split_across_chunks() {
        let mut buffer = SseLineBuffer::default();
        assert!(collect(&mut buffer, b"data: {\"te").is_empty());
        assert_eq!(
            collect(&mut buffer, b"xt\":\"hi\"}\n"),
            vec!["{\"text\":\"hi\"}"]
        );
    }

    #[test]
    fn handles_chunk_boundary_inside_multibyte_char() {
        let payload = "data: {\"text\":\"中文\"}\n".as_bytes();
        // Split inside 中's three-byte encoding.
        let split = payload.iter().position(|&b| b > 0x7f).unwrap() + 1;
        let mut buffer = SseLineBuffer::default();
        assert!(collect(&mut buffer, &payload[..split]).is_empty());
        assert_eq!(
            collect(&mut buffer, &payload[split..]),
            vec!["{\"text\":\"中文\"}"]
        );
    }

    #[test]
    fn strips_crlf_line_endings() {
        let mut buffer = SseLineBuffer::default();
        assert_eq!(collect(&mut buffer, b"data: [DONE]\r\n"), vec!["[DONE]"]);
    }
}
