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
            let _ = stream.write_all(response.as_bytes());
        });
        url
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
