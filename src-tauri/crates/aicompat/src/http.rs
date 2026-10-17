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

/// Media requests share the configured proxy, with a capability-specific
/// total timeout and no redirects carrying credentials to another host.
pub fn media_client(timeout_seconds: u64) -> Result<reqwest::Client, String> {
    let mut client = builder().timeout(Duration::from_secs(timeout_seconds)).redirect(reqwest::redirect::Policy::none());
    if let Some(proxy) = PROXY_URL.read().map_err(|_| "proxy configuration unavailable")?.as_ref() {
        client = client.proxy(reqwest::Proxy::all(proxy).map_err(|_| "invalid proxy configuration")?);
    }
    client.build().map_err(|_| "cannot create media client".to_string())
}

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
}

fn streaming_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(STREAM_READ_TIMEOUT)
}

fn with_proxy(build: fn() -> reqwest::ClientBuilder) -> reqwest::Client {
    PROXY_URL
        .read()
        .unwrap()
        .clone()
        .and_then(|u| reqwest::Proxy::all(u).ok())
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

/// Reassembles `data:` payload lines from raw SSE body chunks, whose
/// boundaries can land anywhere - mid-line, even mid-way through a
/// multi-byte UTF-8 character - so bytes are buffered and only complete
/// lines (which SSE guarantees are whole UTF-8 units) get decoded.
#[derive(Default)]
struct SseLineBuffer {
    buf: Vec<u8>,
}

impl SseLineBuffer {
    fn push(&mut self, chunk: &[u8], mut on_data: impl FnMut(&str)) {
        self.buf.extend_from_slice(chunk);
        while let Some(newline) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\n', '\r']);
            if let Some(data) = line.strip_prefix("data:") {
                on_data(data.strip_prefix(' ').unwrap_or(data));
            }
        }
    }
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
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("{provider_label} stream failed: {e}"))?;
        lines.push(&chunk, &mut on_data);
    }
    Ok(())
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
