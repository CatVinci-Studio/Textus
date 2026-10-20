//! The search services Textus's own web_search can use when the model has
//! no search of its own (Settings > Textus AI > Search service). Each is a
//! request and a parse, kept apart so the tests can run both against a
//! local server and canned answers - no test calls a real service.
//!
//! DeepSeek, Zhipu and Kimi use the key the user already has for that AI
//! provider; Bocha, Tavily, Brave and Exa a key of their own; SearXNG the
//! address of a server the user runs.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);

/// One search service. The ids are what Settings stores
/// (`aiSearchService` in src/settings/SettingsContext.tsx, which lists the
/// same ones).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Deepseek,
    Zhipu,
    Kimi,
    Bocha,
    Tavily,
    Brave,
    Exa,
    Searxng,
}

impl Backend {
    pub(crate) fn from_id(id: &str) -> Option<Self> {
        serde_json::from_value(Value::String(id.to_string())).ok()
    }

    /// The name the model and the error messages use.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Backend::Deepseek => "DeepSeek",
            Backend::Zhipu => "Zhipu",
            Backend::Kimi => "Kimi",
            Backend::Bocha => "Bocha",
            Backend::Tavily => "Tavily",
            Backend::Brave => "Brave Search",
            Backend::Exa => "Exa",
            Backend::Searxng => "SearXNG",
        }
    }

    /// Where its key is kept in provider_keys.json (auth/keys.rs): the AI
    /// provider's own for the three that share it, `search-<id>` for the
    /// rest. SearXNG takes an address instead, from Settings.
    pub(crate) fn key_id(self) -> Option<&'static str> {
        Some(match self {
            Backend::Deepseek => "deepseek",
            Backend::Zhipu => "zhipu",
            Backend::Kimi => "moonshot",
            Backend::Bocha => "search-bocha",
            Backend::Tavily => "search-tavily",
            Backend::Brave => "search-brave",
            Backend::Exa => "search-exa",
            Backend::Searxng => return None,
        })
    }

    fn endpoint(self) -> &'static str {
        match self {
            Backend::Deepseek => "https://api.deepseek.com/v1/tools/search",
            Backend::Zhipu => "https://open.bigmodel.cn/api/paas/v4/web_search",
            Backend::Kimi => "https://api.moonshot.cn/v1/tools/search",
            Backend::Bocha => "https://api.bochaai.com/v1/web-search",
            Backend::Tavily => "https://api.tavily.com/search",
            Backend::Brave => "https://api.search.brave.com/res/v1/web/search",
            Backend::Exa => "https://api.exa.ai/search",
            Backend::Searxng => "",
        }
    }
}

/// One search result.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub date: Option<String>,
    pub site: Option<String>,
}

/// A search service ready to use: which one, and its key (or SearXNG's
/// address).
#[derive(Clone, Debug)]
pub(crate) struct Service {
    pub backend: Backend,
    pub credential: String,
    /// Where requests go instead of the service's own address - the tests'
    /// local server.
    pub endpoint: Option<String>,
}

impl Service {
    pub(crate) fn new(backend: Backend, credential: String) -> Self {
        Self {
            backend,
            credential,
            endpoint: None,
        }
    }

    fn url(&self) -> String {
        if let Some(endpoint) = &self.endpoint {
            return endpoint.clone();
        }
        match self.backend {
            Backend::Searxng => format!("{}/search", self.credential.trim_end_matches('/')),
            backend => backend.endpoint().to_string(),
        }
    }

    /// Up to `count` results for `query`. `question` is the user's message,
    /// which DeepSeek's service takes to rank by.
    pub(crate) async fn search(
        &self,
        query: &str,
        count: usize,
        question: &str,
    ) -> Result<Vec<Hit>, String> {
        let client = http_client()?;
        let response = self
            .request(&client, query, count, question)
            .send()
            .await
            .map_err(|e| self.unreachable(e))?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(self.refused(status, &body));
        }
        let value: Value = serde_json::from_str(&body)
            .map_err(|_| format!("{} sent an answer that isn't JSON.", self.backend.label()))?;
        let mut hits = parse(self.backend, &value)?;
        hits.retain(|h| h.url.starts_with("http"));
        hits.truncate(count);
        Ok(hits)
    }

    fn request(
        &self,
        client: &reqwest::Client,
        query: &str,
        count: usize,
        question: &str,
    ) -> reqwest::RequestBuilder {
        let url = self.url();
        let key = self.credential.as_str();
        match self.backend {
            Backend::Deepseek => client.post(url).bearer_auth(key).json(&json!({
                "query": query,
                "count": count,
                // What the user asked, for ranking: DeepSeek Harness sends
                // the same, cut to 128 characters.
                "ori_question": question.chars().take(128).collect::<String>(),
            })),
            Backend::Zhipu => client.post(url).bearer_auth(key).json(&json!({
                "search_query": query,
                "search_engine": "search_std",
                "count": count,
            })),
            Backend::Kimi => client.post(url).bearer_auth(key).json(&json!({
                "text_query": query,
                "limit": count,
            })),
            Backend::Bocha => client.post(url).bearer_auth(key).json(&json!({
                "query": query,
                "count": count,
                "summary": false,
            })),
            Backend::Tavily => client.post(url).bearer_auth(key).json(&json!({
                "query": query,
                "max_results": count,
                "search_depth": "basic",
            })),
            Backend::Brave => client
                .get(url)
                .header("X-Subscription-Token", key)
                .header(reqwest::header::ACCEPT, "application/json")
                .query(&[("q", query), ("count", &count.to_string())]),
            Backend::Exa => client.post(url).header("x-api-key", key).json(&json!({
                "query": query,
                "numResults": count,
                "contents": {"highlights": true},
            })),
            Backend::Searxng => client.get(url).query(&[("q", query), ("format", "json")]),
        }
    }

    fn unreachable(&self, e: reqwest::Error) -> String {
        if e.is_timeout() {
            format!("{} took too long to answer.", self.backend.label())
        } else {
            format!("Couldn't reach {}.", self.backend.label())
        }
    }

    /// What a failed answer means, in words the model can pass on.
    fn refused(&self, status: reqwest::StatusCode, body: &str) -> String {
        let label = self.backend.label();
        let detail: String = body.chars().take(200).collect();
        match (self.backend, status.as_u16()) {
            (Backend::Searxng, 403) => format!(
                "This SearXNG server doesn't answer in JSON: add `json` under `search.formats` in its settings.yml. ({detail})"
            ),
            (_, 401 | 403) => format!(
                "{label} refused the key - check it in Settings > Textus AI > Search service. ({detail})"
            ),
            (_, 402 | 429) => format!(
                "{label} says the account is out of searches or credit for now. ({detail})"
            ),
            _ => format!("{label} search failed ({status}): {detail}"),
        }
    }

    /// DeepSeek's page reader, for a page Textus couldn't download itself
    /// (blocked where the user is, say). The title, and the page as
    /// Markdown.
    pub(crate) async fn fetch_page(&self, page: &str) -> Option<Result<(String, String), String>> {
        if self.backend != Backend::Deepseek {
            return None;
        }
        let url = match &self.endpoint {
            Some(endpoint) => format!("{endpoint}/fetch"),
            None => "https://api.deepseek.com/v1/tools/fetch".to_string(),
        };
        let client = match http_client() {
            Ok(client) => client,
            Err(e) => return Some(Err(e)),
        };
        let answer = async {
            let response = client
                .post(url)
                .bearer_auth(&self.credential)
                .json(&json!({ "url": page }))
                .send()
                .await
                .map_err(|e| self.unreachable(e))?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(self.refused(status, &body));
            }
            let value: Value = serde_json::from_str(&body)
                .map_err(|_| "DeepSeek sent an answer that isn't JSON.".to_string())?;
            let content = text(&value, "content");
            if content.trim().is_empty() {
                return Err("DeepSeek found no readable text on that page.".to_string());
            }
            Ok((text(&value, "title"), content))
        };
        Some(answer.await)
    }
}

/// A client for the search services: through the app's proxy when one is
/// set, like the AI providers' requests - the services are on the public
/// internet, so no address checks are needed.
fn http_client() -> Result<reqwest::Client, String> {
    let builder = crate::net::client(CONNECT_TIMEOUT, TOTAL_TIMEOUT);
    let builder = match aicompat::http::proxy_url() {
        Some(proxy) => builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?),
        None => builder,
    };
    builder.build().map_err(|e| e.to_string())
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn optional(value: &Value, key: &str) -> Option<String> {
    Some(text(value, key)).filter(|s| !s.is_empty())
}

/// Brave marks the query's words in its descriptions with <strong>.
fn without_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The results in one service's answer, or the error it reports inside a
/// successful response (Zhipu and Bocha do).
pub(crate) fn parse(backend: Backend, value: &Value) -> Result<Vec<Hit>, String> {
    let list = |pointer: &str| {
        value
            .pointer(pointer)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let error = value.get("error").filter(|e| !e.is_null()).map(|e| {
        e.get("message")
            .and_then(Value::as_str)
            .map_or(e.to_string(), str::to_string)
    });
    if let Some(message) = error {
        return Err(format!("{} search failed: {message}", backend.label()));
    }
    let hits = match backend {
        Backend::Deepseek => list("/results")
            .iter()
            .map(|r| Hit {
                title: text(r, "title"),
                url: text(r, "url"),
                snippet: optional(r, "snippet").unwrap_or_else(|| text(r, "summary")),
                date: optional(r, "date"),
                site: optional(r, "site_name"),
            })
            .collect(),
        Backend::Zhipu => list("/search_result")
            .iter()
            .map(|r| Hit {
                title: text(r, "title"),
                url: text(r, "link"),
                snippet: text(r, "content"),
                date: optional(r, "publish_date"),
                site: optional(r, "media"),
            })
            .collect(),
        Backend::Kimi => list("/search_results")
            .iter()
            .map(|r| Hit {
                title: text(r, "title"),
                url: text(r, "url"),
                snippet: optional(r, "snippet").unwrap_or_else(|| {
                    r.pointer("/chunks/0/text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                }),
                date: optional(r, "date"),
                site: optional(r, "site_name"),
            })
            .collect(),
        Backend::Bocha => {
            // Bocha wraps its answer in {code, msg, data} - and reports a
            // failure there with a 200.
            if let Some(code) = value.get("code").and_then(Value::as_i64) {
                if code != 200 {
                    let msg = value.get("msg").and_then(Value::as_str).unwrap_or("");
                    return Err(format!("Bocha search failed ({code}): {msg}"));
                }
            }
            let mut results = list("/data/webPages/value");
            if results.is_empty() {
                results = list("/webPages/value");
            }
            results
                .iter()
                .map(|r| Hit {
                    title: text(r, "name"),
                    url: text(r, "url"),
                    snippet: optional(r, "snippet").unwrap_or_else(|| text(r, "summary")),
                    date: optional(r, "datePublished"),
                    site: optional(r, "siteName"),
                })
                .collect()
        }
        Backend::Tavily => list("/results")
            .iter()
            .map(|r| Hit {
                title: text(r, "title"),
                url: text(r, "url"),
                snippet: text(r, "content"),
                date: optional(r, "published_date"),
                site: None,
            })
            .collect(),
        Backend::Brave => list("/web/results")
            .iter()
            .map(|r| Hit {
                title: without_tags(&text(r, "title")),
                url: text(r, "url"),
                snippet: without_tags(&text(r, "description")),
                date: optional(r, "page_age"),
                site: r
                    .pointer("/profile/name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
            .collect(),
        Backend::Exa => list("/results")
            .iter()
            .map(|r| {
                let highlights: Vec<&str> = r
                    .get("highlights")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                Hit {
                    title: text(r, "title"),
                    url: text(r, "url"),
                    snippet: if highlights.is_empty() {
                        optional(r, "summary").unwrap_or_else(|| text(r, "text"))
                    } else {
                        highlights.join(" … ")
                    },
                    date: optional(r, "publishedDate"),
                    site: None,
                }
            })
            .collect(),
        Backend::Searxng => list("/results")
            .iter()
            .map(|r| Hit {
                title: text(r, "title"),
                url: text(r, "url"),
                snippet: text(r, "content"),
                date: optional(r, "publishedDate"),
                site: None,
            })
            .collect(),
    };
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Answers one request on a local port with a JSON `body` and the
    /// HTTP `status`, and hands back the request it got.
    fn serve(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
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
}
