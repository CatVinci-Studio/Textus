//! What the commands calling web servers share: a client that gives up on a
//! silent server, and a body read capped at a size.

use std::time::Duration;

/// A client that gives up connecting after `connect` and on the whole
/// request, body included, after `total`. The caller adds anything else it
/// needs (a redirect policy) and builds it.
pub fn client(connect: Duration, total: Duration) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(connect)
        .timeout(total)
        .user_agent(concat!("Textus/", env!("CARGO_PKG_VERSION")))
}

/// [`client`] for servers elsewhere: through the app's network proxy when
/// one is set, like the AI providers' requests; this computer's own servers
/// (PicGo, a plugin's local app) directly. An app started from the desktop
/// doesn't inherit HTTPS_PROXY, so where only a proxy reaches GitHub, going
/// direct fails (the plugin and theme catalogs, #512, #580).
pub fn public_client(connect: Duration, total: Duration) -> Result<reqwest::ClientBuilder, String> {
    through(client(connect, total), aicompat::http::proxy_url())
}

/// `builder` through `proxy`, if there is one. Without one the builder is
/// pinned to direct: a proxy in the terminal's environment must not hijack
/// a request to this computer either (aicompat::http::proxy_for
/// keeps the loopback family out of a proxy that is set).
fn through(
    builder: reqwest::ClientBuilder,
    proxy: Option<String>,
) -> Result<reqwest::ClientBuilder, String> {
    Ok(match proxy {
        Some(proxy) => builder.proxy(aicompat::http::proxy_for(&proxy)?),
        None => builder.no_proxy(),
    })
}

/// `error` with its causes: reqwest's own text for a failed connection is only
/// "error sending request for url (...)", which doesn't say whether the name,
/// the connection or TLS failed.
pub fn error_text(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut cause = std::error::Error::source(error);
    while let Some(next) = cause {
        let more = next.to_string();
        if !text.contains(&more) {
            text = format!("{text}: {more}");
        }
        cause = next.source();
    }
    if let Some(hint) = dns_hint(&text) {
        text = format!("{text} ({hint})");
    }
    text
}

/// What a failed name lookup means here: behind a proxy, the address that
/// failed to resolve is the proxy's own, so the raw OS error (Windows'
/// 11001, Unix's "Name or service not known") reads like the site is gone.
fn dns_hint(text: &str) -> Option<&'static str> {
    const NAMES: [&str; 4] = [
        "os error 11001",
        "nodename nor servname",
        "name or service not known",
        "Temporary failure in name resolution",
    ];
    NAMES
        .iter()
        .find(|name| text.contains(*name))
        .map(|_| "a name didn't resolve - if a proxy is set, its address must resolve: use its IP, or check the system proxy")
}

/// The response's body, or None if it is longer than `max` bytes, judged by the
/// declared length or else while reading.
pub async fn read_limited(
    mut response: reqwest::Response,
    max: usize,
) -> Result<Option<Vec<u8>>, String> {
    if response.content_length().unwrap_or(0) > max as u64 {
        return Ok(None);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > max {
            return Ok(None);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Answers one request on a local port with `response`, written as is.
    fn serve_once(response: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        answer_once(listener, response.as_bytes());
        url
    }

    /// Reads one request's head on `listener`, then writes `response`.
    fn answer_once(listener: std::net::TcpListener, response: &'static [u8]) {
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 1024];
            while !request.ends_with(b"\r\n\r\n") {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
            }
            let _ = stream.write_all(response);
        });
    }

    async fn read(response: &'static str, max: usize) -> Option<Vec<u8>> {
        let client = client(Duration::from_secs(5), Duration::from_secs(5))
            .build()
            .unwrap();
        let response = client.get(serve_once(response)).send().await.unwrap();
        read_limited(response, max).await.unwrap()
    }

    // Chunked: no declared length, so the limit is checked while reading.
    const CHUNKED: &str = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n";

    #[tokio::test]
    async fn a_body_within_the_limit_is_read_whole() {
        assert_eq!(read(CHUNKED, 6).await.as_deref(), Some(&b"abcdef"[..]));
    }

    #[tokio::test]
    async fn a_body_that_grows_past_the_limit_is_cut_off() {
        assert_eq!(read(CHUNKED, 5).await, None);
    }

    #[tokio::test]
    async fn a_declared_length_over_the_limit_is_refused_unread() {
        let response = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nabc";
        assert_eq!(read(response, 10).await, None);
    }

    #[tokio::test]
    async fn a_request_goes_through_the_proxy_when_there_is_one() {
        // The "proxy" answers for a host that doesn't exist, so only a
        // request sent through it can succeed.
        let proxy =
            serve_once("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        let client = through(
            client(Duration::from_secs(5), Duration::from_secs(5)),
            Some(proxy),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = client
            .get("http://catalog.invalid/index.json")
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
    }

    #[tokio::test]
    async fn a_proxy_asking_for_a_name_and_password_gets_them() {
        // The "proxy" answers a request without Proxy-Authorization with
        // the 407 a proxy that wants a name and password gives, and lets
        // one that carries them through: what the credentials in the
        // proxy's URL are for.
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buf = [0u8; 4096];
                while !request.ends_with(b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buf[..n]);
                }
                // The name and password as typed: "p%41 x", not "pA x".
                let carries = String::from_utf8_lossy(&request).contains("Basic YWxpY2U6cCU0MSB4");
                let answer = if carries {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                } else {
                    "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        let unauthorized = through(
            client(Duration::from_secs(5), Duration::from_secs(5)),
            Some(proxy.clone()),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = unauthorized
            .get("http://catalog.invalid/index.json")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            reqwest::StatusCode::PROXY_AUTHENTICATION_REQUIRED
        );
        let with_credentials = proxy.trim_start_matches("http://").to_string();
        let authorized = through(
            client(Duration::from_secs(5), Duration::from_secs(5)),
            // As settings write it: % escaped first, then the URL's own.
            Some(format!("http://alice:p%2541%20x@{with_credentials}")),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = authorized
            .get("http://catalog.invalid/index.json")
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
    }

    #[tokio::test]
    async fn this_computers_servers_are_reached_directly() {
        // A proxy that answers nothing: only a direct request can succeed.
        let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = format!("http://{}", dead.local_addr().unwrap());
        let local =
            serve_once("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        let client = through(
            client(Duration::from_secs(5), Duration::from_millis(500)),
            Some(proxy),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = client.get(local).send().await.unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        drop(dead);
    }

    #[tokio::test]
    async fn a_socks_proxy_is_reached_and_speaks_socks() {
        // The `socks` feature must be compiled in: without it a socks5h
        // proxy address is accepted by the setting but every request fails
        // before it leaves the computer. A SOCKS5 greeting starts with its
        // version, 5 - the byte the proxy below waits for.
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = format!("socks5h://{}", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
        let record = seen.clone();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut version = [0u8; 1];
                if stream.read(&mut version).is_ok() {
                    *record.lock().unwrap() = Some(version[0]);
                }
            }
        });
        let client = through(
            client(Duration::from_secs(5), Duration::from_secs(5)),
            Some(proxy),
        )
        .unwrap()
        .build()
        .unwrap();
        // The greeting arrives first; the request itself fails against this
        // proxy that never answers, which is fine here.
        let _ = client.get("http://example.invalid/").send().await;
        for _ in 0..100 {
            if seen.lock().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(*seen.lock().unwrap(), Some(5));
    }

    #[test]
    fn an_unreadable_proxy_is_an_error() {
        let builder = client(Duration::from_secs(5), Duration::from_secs(5));
        assert!(through(builder, Some("not a url".into())).is_err());
    }

    #[tokio::test]
    async fn every_loopback_address_is_reached_directly() {
        // A dead proxy is set, and the server listens on a loopback address
        // beyond 127.0.0.1, which only a request exempted from the whole
        // loopback family - not just 127.0.0.1 - reaches. macOS won't hand
        // out such an address to bind, so there the same request runs
        // against 127.0.0.1 itself.
        let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = format!("http://{}", dead.local_addr().unwrap());
        let server = std::net::TcpListener::bind("127.0.0.5:0")
            .or_else(|_| std::net::TcpListener::bind("127.0.0.1:0"))
            .unwrap();
        let local = format!("http://{}", server.local_addr().unwrap());
        answer_once(
            server,
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
        );
        let client = through(
            client(Duration::from_secs(5), Duration::from_secs(5)),
            Some(proxy),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = client.get(local).send().await.unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        drop(dead);
    }

    #[tokio::test]
    async fn a_failed_connection_says_why() {
        // A port nothing listens on: refused.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let client = client(Duration::from_secs(5), Duration::from_secs(5))
            .no_proxy()
            .build()
            .unwrap();
        let err = client
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .await
            .unwrap_err();
        let text = error_text(&err);
        assert!(text.starts_with(&err.to_string()), "{text}");
        assert!(text.len() > err.to_string().len(), "{text}");
    }

    #[test]
    fn a_failed_name_lookup_gets_a_hint() {
        // What Windows reports when a proxy's address doesn't resolve
        // (11001), and the two Unix wordings: each gets the hint, other
        // errors don't.
        for raw in [
            "tunnel error: failed to create underlying connection: error trying to connect: dns error: 无效的主机名 (os error 11001)",
            "dns error: nodename nor servname provided",
            "dns error: Temporary failure in name resolution",
        ] {
            let text = dns_hint(raw).expect(raw);
            assert!(text.contains("use its IP"), "{text}");
        }
        assert!(dns_hint("error trying to connect: connection refused").is_none());
    }

    #[tokio::test]
    async fn a_server_that_never_answers_times_out() {
        // Bound but never accepted from: the connection opens, no answer comes.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let client = client(Duration::from_secs(5), Duration::from_millis(200))
            .build()
            .unwrap();
        let err = client.get(url).send().await.unwrap_err();
        assert!(err.is_timeout(), "{err}");
        drop(listener);
    }
}
