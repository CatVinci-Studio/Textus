//! web_fetch's download: one page from the open web, read as text.
//!
//! The model picks the URL, and a URL can point anywhere - a router's admin
//! page, a cloud metadata service, a dev server on localhost - so the page
//! is only fetched from an address on the public internet. The host is
//! resolved here, every address it resolves to is checked, and the
//! connection is pinned to those addresses, so a second lookup can't
//! answer differently (DNS rebinding). A redirect is followed only on the
//! same host, each hop checked again; one to another host comes back to the
//! model as such, which may fetch it with a call of its own (as DeepSeek
//! Harness does). No cookies are kept or sent, and every request has a time
//! and size limit.

use aicompat::public_address::{all_public, is_local_name, is_public};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

/// Most of a page's text handed to the model. A writing request needs the
/// facts of a page, not all of a long one; DeepSeek Harness's 200,000 was
/// too expensive to resend on every step of a conversation.
pub(crate) const MAX_PAGE_CHARS: usize = 30_000;
/// Most bytes downloaded for one page, before any of it is read as text.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);

/// A page, read.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Page {
    /// Where the page was in the end, after same-host redirects.
    pub url: String,
    pub title: String,
    /// Markdown, or plain text.
    pub text: String,
    /// `text` was cut at MAX_PAGE_CHARS.
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Fetched {
    Page(Page),
    /// The page moved to another host, which isn't followed blind.
    Moved {
        to: String,
    },
}

/// What a fetch may reach. Only the tests loosen it, to fetch from a
/// server of their own on 127.0.0.1.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Reach {
    pub allow_local: bool,
}

pub(crate) const REFUSED: &str =
    "That address is on this computer or a private network; web_fetch only reads public web pages.";

/// The URL web_fetch is asked for, as it will be fetched: http(s) only,
/// with no user name or password in it, and plain http upgraded to https -
/// most sites serve both, and the page then can't be read or changed on
/// the way.
pub(crate) fn target(raw: &str, reach: Reach) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| format!("Not a web address: {}", raw.trim()))?;
    match url.scheme() {
        "https" => {}
        "http" if reach.allow_local => {}
        "http" => {
            url.set_scheme("https").ok();
            if url.port() == Some(80) {
                url.set_port(None).ok();
            }
        }
        _ => return Err("web_fetch reads http and https addresses only.".to_string()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("web_fetch doesn't send user names or passwords.".to_string());
    }
    url.set_fragment(None);
    Ok(url)
}

/// A client for one request to `url`, refusing it when the host isn't on
/// the public internet. Direct: the host's addresses are looked up and
/// checked here, and the connection is pinned to them. Through the app's
/// proxy (Settings > Privacy), which looks the name up itself and is how
/// many users reach foreign sites at all: only literal private addresses
/// and local names can be refused - a concession, since the proxy may still
/// reach what a public-looking name resolves to on its side.
async fn client_for(url: &reqwest::Url, reach: Reach) -> Result<reqwest::Client, String> {
    let host = url.host_str().ok_or_else(|| REFUSED.to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let literal: Option<IpAddr> = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok();
    let builder = crate::net::client(CONNECT_TIMEOUT, TOTAL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none());
    if !reach.allow_local && (is_local_name(host) || literal.is_some_and(|ip| !is_public(ip))) {
        return Err(REFUSED.to_string());
    }
    if let Some(proxy) = aicompat::http::proxy_url().filter(|_| !reach.allow_local) {
        let proxy = reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?;
        return builder.proxy(proxy).build().map_err(|e| e.to_string());
    }
    let builder = builder.no_proxy();
    if literal.is_some() {
        return builder.build().map_err(|e| e.to_string());
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| format!("Couldn't find the site {host}."))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("Couldn't find the site {host}."));
    }
    if !reach.allow_local && !all_public(addrs.iter().map(SocketAddr::ip)) {
        return Err(REFUSED.to_string());
    }
    builder
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|e| e.to_string())
}

/// One site for following a redirect: the same host and port, `www.` or
/// not - rust-lang.org's own www. address redirects there.
fn same_site(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    let host = |u: &reqwest::Url| {
        u.host_str()
            .map(|h| h.trim_start_matches("www.").to_ascii_lowercase())
    };
    host(a) == host(b) && a.port_or_known_default() == b.port_or_known_default()
}

/// Downloads `raw` and reads it as text: an HTML page's main content as
/// Markdown, plain text and Markdown as they are, a PDF's text layer.
pub(crate) async fn fetch(raw: &str, reach: Reach) -> Result<Fetched, String> {
    let mut url = target(raw, reach)?;
    for _ in 0..=MAX_REDIRECTS {
        let client = client_for(&url, reach).await?;
        let response = client
            .get(url.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.5",
            )
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    format!("{} took too long to answer.", url.host_str().unwrap_or(""))
                } else {
                    format!("Couldn't reach {}.", url.host_str().unwrap_or(""))
                }
            })?;
        let status = response.status();
        if status.is_redirection() {
            let next = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|l| l.to_str().ok())
                .and_then(|l| url.join(l).ok())
                .ok_or_else(|| format!("The page redirected without saying where ({status})."))?;
            let next = target(next.as_str(), reach)?;
            if !same_site(&url, &next) {
                return Ok(Fetched::Moved {
                    to: next.to_string(),
                });
            }
            url = next;
            continue;
        }
        if !status.is_success() {
            return Err(format!("The site answered {status}."));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let body = crate::net::read_limited(response, MAX_BODY_BYTES)
            .await?
            .ok_or_else(|| "The page is too large to read.".to_string())?;
        return read_page(&url, &content_type, &body).map(Fetched::Page);
    }
    Err("The page redirected too many times.".to_string())
}

/// What a downloaded body says, as a [`Page`].
pub(crate) fn read_page(
    url: &reqwest::Url,
    content_type: &str,
    body: &[u8],
) -> Result<Page, String> {
    let mime = content_type.split(';').next().unwrap_or("").trim();
    let looks_html = || {
        let head = String::from_utf8_lossy(&body[..body.len().min(512)]).to_ascii_lowercase();
        head.contains("<html") || head.contains("<!doctype html")
    };
    let (title, text) = match mime {
        "text/html" | "application/xhtml+xml" => {
            super::extract::page_markdown(&decode(content_type, body), url.as_str())
        }
        "application/pdf" => (String::new(), crate::extract::pdf_text_from_bytes(body)?),
        "" if body.starts_with(b"%PDF") => {
            (String::new(), crate::extract::pdf_text_from_bytes(body)?)
        }
        _ if mime.is_empty() && looks_html() => {
            super::extract::page_markdown(&decode(content_type, body), url.as_str())
        }
        _ if mime.starts_with("text/")
            || mime == "application/json"
            || mime.ends_with("+json")
            || mime.ends_with("+xml")
            || mime == "application/xml"
            || mime.is_empty() =>
        {
            (String::new(), decode(content_type, body))
        }
        _ => {
            return Err(format!(
                "This address is a file web_fetch can't read ({mime})."
            ))
        }
    };
    let text = text.trim();
    if text.is_empty() {
        return Err(
            "The page has no readable text - it may need JavaScript to show anything.".to_string(),
        );
    }
    let truncated = text.chars().count() > MAX_PAGE_CHARS;
    let text = if truncated {
        text.chars().take(MAX_PAGE_CHARS).collect()
    } else {
        text.to_string()
    };
    Ok(Page {
        url: url.to_string(),
        title: title.trim().to_string(),
        text,
        truncated,
    })
}

/// The body as text, in the charset the Content-Type header or the page's
/// own `<meta charset>` names - many Chinese sites still serve GBK.
fn decode(content_type: &str, body: &[u8]) -> String {
    let declared = |s: &str| {
        let lower = s.to_ascii_lowercase();
        let at = lower.find("charset=")? + "charset=".len();
        let name: String = lower[at..]
            .trim_start_matches(['"', '\''])
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        encoding_rs::Encoding::for_label(name.as_bytes())
    };
    let sniffed = || {
        let head = String::from_utf8_lossy(&body[..body.len().min(2048)]).into_owned();
        declared(&head)
    };
    let encoding = declared(content_type)
        .or_else(sniffed)
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(body).0.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn only_web_addresses_are_fetched_and_http_becomes_https() {
        let strict = Reach::default();
        assert_eq!(
            target("http://example.com/a#b", strict).unwrap().as_str(),
            "https://example.com/a"
        );
        assert!(target("file:///etc/passwd", strict).is_err());
        assert!(target("ftp://example.com/", strict).is_err());
        assert!(target("https://user:pw@example.com/", strict).is_err());
        assert!(target("not a url", strict).is_err());
    }

    #[tokio::test]
    async fn local_and_private_hosts_are_refused_before_connecting() {
        for url in [
            "https://localhost/",
            "https://127.0.0.1/",
            "https://[::1]:8080/",
            "https://169.254.169.254/latest/meta-data/",
            "https://printer.local/",
            "https://10.0.0.1/admin",
            "https://[::ffff:127.0.0.1]/",
            "https://[64:ff9b::a9fe:a9fe]/",
            "https://[2002:c0a8:0101::1]/",
            "https://100.64.0.1/",
        ] {
            let err = fetch(url, Reach::default()).await.unwrap_err();
            assert_eq!(err, REFUSED, "{url}");
        }
    }

    /// Answers each request on a local port with the next of `responses`,
    /// and returns the address and the requests it was sent.
    fn serve(responses: Vec<String>) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while !request.ends_with(b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buf[..n]);
                }
                let _ = tx.send(String::from_utf8_lossy(&request).into_owned());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (base, rx)
    }

    fn http(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    const LOCAL: Reach = Reach { allow_local: true };

    #[tokio::test]
    async fn a_page_comes_back_as_its_readable_text() {
        let html = "<html><head><title>Tides</title></head><body><nav>Home | About</nav><article><h1>Tides</h1><p>The moon pulls the sea twice a day, and the water rises and falls along every coast of the world in a rhythm sailors have counted on for centuries.</p><p>Spring tides come at new and full moon, when the sun and the moon pull in a line.</p></article><script>track()</script></body></html>";
        let (base, _) = serve(vec![http(
            "200 OK",
            "Content-Type: text/html; charset=utf-8\r\n",
            html,
        )]);
        let Fetched::Page(page) = fetch(&format!("{base}/tides"), LOCAL).await.unwrap() else {
            panic!("a page");
        };
        assert_eq!(page.title, "Tides");
        assert!(page.text.contains("Spring tides come at new and full moon"));
        assert!(!page.text.contains("track()"), "{}", page.text);
        assert!(!page.truncated);
    }

    #[tokio::test]
    async fn a_same_host_redirect_is_followed_and_another_host_is_reported() {
        let (base, _) = serve(vec![
            http("301 Moved Permanently", "Location: /new\r\n", ""),
            http("200 OK", "Content-Type: text/plain\r\n", "moved here"),
        ]);
        let Fetched::Page(page) = fetch(&format!("{base}/old"), LOCAL).await.unwrap() else {
            panic!("a page");
        };
        assert_eq!(page.text, "moved here");
        assert!(page.url.ends_with("/new"));

        let (base, _) = serve(vec![http(
            "302 Found",
            "Location: https://elsewhere.example/page\r\n",
            "",
        )]);
        assert_eq!(
            fetch(&format!("{base}/old"), LOCAL).await.unwrap(),
            Fetched::Moved {
                to: "https://elsewhere.example/page".into()
            }
        );
    }

    #[test]
    fn www_and_the_bare_domain_are_one_site() {
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        assert!(same_site(
            &url("https://www.rust-lang.org/"),
            &url("https://rust-lang.org/")
        ));
        assert!(!same_site(
            &url("https://rust-lang.org/"),
            &url("https://evil.example/")
        ));
        assert!(!same_site(
            &url("https://a.example/"),
            &url("https://a.example:8443/")
        ));
    }

    #[tokio::test]
    async fn redirect_loops_stop() {
        let (base, _) = serve(vec![http("302 Found", "Location: /loop\r\n", ""); 8]);
        let err = fetch(&format!("{base}/loop"), LOCAL).await.unwrap_err();
        assert!(err.contains("too many times"), "{err}");
    }

    #[tokio::test]
    async fn no_cookies_are_sent_back() {
        let (base, requests) = serve(vec![
            http("302 Found", "Set-Cookie: id=1\r\nLocation: /next\r\n", ""),
            http("200 OK", "Content-Type: text/plain\r\n", "ok"),
        ]);
        fetch(&format!("{base}/start"), LOCAL).await.unwrap();
        requests.recv().unwrap();
        let second = requests.recv().unwrap().to_ascii_lowercase();
        assert!(!second.contains("cookie"), "{second}");
    }

    #[tokio::test]
    async fn a_long_page_is_cut_and_says_so() {
        let body = "word ".repeat(MAX_PAGE_CHARS);
        let (base, _) = serve(vec![http("200 OK", "Content-Type: text/plain\r\n", &body)]);
        let Fetched::Page(page) = fetch(&base, LOCAL).await.unwrap() else {
            panic!("a page");
        };
        assert!(page.truncated);
        assert_eq!(page.text.chars().count(), MAX_PAGE_CHARS);
    }

    #[test]
    fn a_gbk_page_is_decoded_by_its_meta_charset() {
        let (gbk, _, _) = encoding_rs::GBK.encode("<html><head><meta charset=\"gbk\"><title>潮汐</title></head><body><p>月亮每天两次牵引海水。</p></body></html>");
        let url = reqwest::Url::parse("https://example.cn/").unwrap();
        let page = read_page(&url, "text/html", &gbk).unwrap();
        assert_eq!(page.title, "潮汐");
        assert!(page.text.contains("月亮每天两次牵引海水"), "{}", page.text);
    }

    #[test]
    fn files_that_are_not_text_are_refused() {
        let url = reqwest::Url::parse("https://example.com/a.zip").unwrap();
        assert!(read_page(&url, "application/zip", b"PK\x03\x04").is_err());
    }
}
