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
