//! Shared HTTP client construction for every provider request. A GUI app
//! launched from Finder doesn't inherit HTTPS_PROXY, so the proxy follows
//! the system's network settings, or the app's own, mirrored here from the
//! frontend.

use std::sync::RwLock;
use std::time::Duration;

/// Where requests go: the system's proxy, straight out, or a proxy the
/// user set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    /// The proxy the system's network settings name (and HTTPS_PROXY and
    /// the like), as a browser follows it; direct when there is none.
    System,
    Direct,
    Via(String),
}

// Tests run against servers on this computer, whatever its proxy.
static ROUTE: RwLock<Route> = RwLock::new(if cfg!(test) {
    Route::Direct
} else {
    Route::System
});

/// The loopback family, which never goes through a proxy: a model or
/// service on this computer is reached directly whatever the settings say
/// (a proxy in the environment of the terminal that started the app
/// included - see net.rs, which shares this).
const LOOPBACK_NO_PROXY: &str = "localhost,127.0.0.0/8,::1";

/// Total request timeout for whole-body paths, so a hung proxy or endpoint
/// can't hold a request forever. Streamed requests use a per-read idle
/// timeout instead, since a healthy stream can outlive any total cap.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Max silence between two chunks of a streamed body before giving up -
/// generous enough for a model thinking between tokens, short enough that
/// a dead proxy doesn't hold a request forever.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(120);
/// Max time a stream may go without a single event. Keep-alive bytes don't
/// count, so a provider keeping the connection warm after the model stopped
/// can't hold a request forever. Well past the longest thinking a reply needs.
const STREAM_EVENT_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(300)
};

/// Sets where requests go. An unparseable proxy URL is rejected here so a
/// typo fails visibly; an empty one follows the system.
pub fn set_route(route: Route) -> Result<(), String> {
    let route = match route {
        Route::Via(u) if u.trim().is_empty() => Route::System,
        Route::Via(u) => {
            let u = u.trim().to_string();
            reqwest::Proxy::all(u.clone()).map_err(|e| format!("invalid proxy URL: {e}"))?;
            Route::Via(u)
        }
        other => other,
    };
    *ROUTE.write().unwrap() = route;
    Ok(())
}

/// Where requests go, as set.
pub fn current_route() -> Route {
    ROUTE.read().unwrap().clone()
}

/// The proxy requests go through now, for requests that build their own
/// client: the one set, or the system's, or None for direct.
pub fn proxy_url() -> Option<String> {
    match ROUTE.read().unwrap().clone() {
        Route::Via(url) => Some(url),
        Route::Direct => None,
        Route::System => system_proxy(),
    }
}

/// The system's proxy for web requests, read again after a few seconds so
/// a proxy switched on while Textus runs is followed. One proxy for all:
/// the system's bypass list isn't read; this computer is always direct.
fn system_proxy() -> Option<String> {
    use std::sync::Mutex;
    use std::time::Instant;
    static READ: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
    let mut read = READ.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, url)) = read.as_ref() {
        if at.elapsed() < Duration::from_secs(5) {
            return url.clone();
        }
    }
    let url = system_proxy_now();
    *read = Some((Instant::now(), url.clone()));
    url
}

fn system_proxy_now() -> Option<String> {
    // Fork: the Windows settings carry the proxy in forms hyper-util's
    // registry reader drops (see parse_windows_proxy_server); a PAC or a
    // WPAD-discovered one (what the browser follows) isn't in the registry
    // reader's reach at all. WinHTTP answers both, like the browser.
    #[cfg(windows)]
    if let Some(url) = system_proxy_winhttp() {
        return Some(url);
    }
    #[cfg(windows)]
    if let Some(url) = system_proxy_from_registry() {
        return Some(url);
    }
    let matcher = hyper_util::client::proxy::matcher::Matcher::from_system();
    let probe: http::Uri = "https://example.com/".parse().ok()?;
    let found = matcher.intercept(&probe)?;
    let mut url = reqwest::Url::parse(&found.uri().to_string()).ok()?;
    // An HTTP proxy's name and password come as its Basic header.
    let basic = found
        .basic_auth()
        .and_then(|h| h.to_str().ok()?.strip_prefix("Basic ").map(str::to_string))
        .and_then(|b| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.decode(b).ok()
        })
        .and_then(|raw| String::from_utf8(raw).ok());
    let auth = match (found.raw_auth(), &basic) {
        (Some((user, pass)), _) => Some((user, pass)),
        (None, Some(pair)) => pair.split_once(':'),
        _ => None,
    };
    if let Some((user, pass)) = auth {
        let _ = url.set_username(user);
        let _ = url.set_password(Some(pass));
    }
    Some(url.to_string())
}

/// The proxy a Windows machine's IE settings carry, read ourselves: the
/// `ProxyServer` value has two shapes, and hyper-util's registry reader
/// hands the raw string to a URI parser that drops one of them -
/// `http=host:port;https=host:port` (the per-protocol form) fails to parse
/// and the request then goes direct, which on an intranet whose own DNS
/// cannot resolve a site's name fails with a name error, while the browser
/// reads the same setting and works. Fork-only; keep when syncing upstream.
#[cfg(windows)]
fn system_proxy_from_registry() -> Option<String> {
    let settings = windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    if settings.get_u32("ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let raw = settings.get_string("ProxyServer").ok()?;
    parse_windows_proxy_server(&raw)
}

/// The proxy a PAC script or a WPAD-discovered one answers with, asked the
/// way the browser asks: WinHTTP's autoproxy, which evaluates the script
/// for the URL. An auto-detection without a WPAD answer can take seconds,
/// so the result (including "none") is kept for five minutes. Fork-only.
#[cfg(windows)]
fn system_proxy_winhttp() -> Option<String> {
    use std::sync::Mutex;
    use std::time::Instant;
    static READ: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
    let mut read = READ.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, url)) = read.as_ref() {
        if at.elapsed() < Duration::from_secs(300) {
            return url.clone();
        }
    }
    let url = system_proxy_winhttp_now();
    *read = Some((Instant::now(), url.clone()));
    url
}

#[cfg(windows)]
fn system_proxy_winhttp_now() -> Option<String> {
    // An automatic-configuration script, when the IE settings name one;
    // otherwise discovery over DHCP and DNS (WPAD).
    let config_url = windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()
        .and_then(|settings| settings.get_string("AutoConfigURL").ok());

    #[repr(C)]
    struct AutoProxyOptions {
        flags: u32,
        auto_detect_flags: u32,
        auto_config_url: *const u16,
        reserved: *mut core::ffi::c_void,
        reserved_u32: u32,
        auto_logon_if_challenged: i32,
    }
    #[repr(C)]
    struct ProxyInfo {
        access_type: u32,
        proxy: *mut u16,
        bypass: *mut u16,
    }
    const WINHTTP_AUTOPROXY_AUTO_DETECT: u32 = 0x1;
    const WINHTTP_AUTOPROXY_CONFIG_URL: u32 = 0x2;
    const WINHTTP_AUTO_DETECT_TYPE_DHCP: u32 = 0x1;
    const WINHTTP_AUTO_DETECT_TYPE_DNS_A: u32 = 0x2;
    const WINHTTP_ACCESS_TYPE_NO_PROXY: u32 = 1;

    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(
            agent: *const u16,
            access_type: u32,
            proxy: *const u16,
            bypass: *const u16,
            flags: u32,
        ) -> *mut core::ffi::c_void;
        fn WinHttpGetProxyForUrl(
            session: *mut core::ffi::c_void,
            url: *const u16,
            options: *mut AutoProxyOptions,
            info: *mut ProxyInfo,
        ) -> i32;
        fn WinHttpCloseHandle(handle: *mut core::ffi::c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalFree(memory: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let session = unsafe {
        WinHttpOpen(
            wide("Textus").as_ptr(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            std::ptr::null(),
            std::ptr::null(),
            0,
        )
    };
    if session.is_null() {
        return None;
    }
    let config_url_wide = config_url.as_deref().map(|url| wide(url));
    let mut options = AutoProxyOptions {
        flags: WINHTTP_AUTOPROXY_CONFIG_URL,
        auto_detect_flags: WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        auto_config_url: match &config_url_wide {
            Some(url) => url.as_ptr(),
            None => std::ptr::null(),
        },
        reserved: std::ptr::null_mut(),
        reserved_u32: 0,
        auto_logon_if_challenged: 1,
    };
    if config_url.is_none() {
        options.flags = WINHTTP_AUTOPROXY_AUTO_DETECT;
    }
    let probe = wide("https://example.com/");
    let mut info = ProxyInfo {
        access_type: 0,
        proxy: std::ptr::null_mut(),
        bypass: std::ptr::null_mut(),
    };
    let answered =
        unsafe { WinHttpGetProxyForUrl(session, probe.as_ptr(), &mut options, &mut info) != 0 };
    let raw = if answered && !info.proxy.is_null() {
        // The proxy list ends at its nul, whatever came behind it.
        let len = (0..)
            .position(|index| unsafe { *info.proxy.add(index) } == 0)
            .unwrap_or(0);
        let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(info.proxy, len) });
        unsafe { GlobalFree(info.proxy.cast()) };
        if !info.bypass.is_null() {
            unsafe { GlobalFree(info.bypass.cast()) };
        }
        parse_winhttp_proxy(&text)
    } else {
        None
    };
    unsafe { WinHttpCloseHandle(session) };
    raw
}

/// The proxy a WinHTTP autoproxy answer names: PAC script results say
/// "PROXY host:port" (several, then DIRECT), "SOCKS host:port", or the
/// per-protocol form; a bare "host:port" is an HTTP proxy.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_winhttp_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.eq_ignore_ascii_case("direct") {
        return None;
    }
    if let Some(rest) = raw.strip_prefix("PROXY ") {
        let first = rest
            .split([',', ';', ' '])
            .map(str::trim)
            .find(|entry| !entry.is_empty())?;
        return Some(format!("http://{first}"));
    }
    if let Some(rest) = raw.strip_prefix("SOCKS ") {
        let first = rest
            .split([',', ';', ' '])
            .map(str::trim)
            .find(|entry| !entry.is_empty())?;
        return Some(format!("socks5h://{first}"));
    }
    parse_windows_proxy_server(raw)
}

/// The proxy URL in a Windows `ProxyServer` value: either `host:port`
/// (one proxy for every protocol) or the per-protocol form
/// `http=host:port;https=host:port;...`, from which https wins, then http.
/// A scheme already present stays.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_windows_proxy_server(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if ["http://", "https://", "socks5h://", "socks5://"]
        .iter()
        .any(|scheme| raw.starts_with(scheme))
    {
        return Some(raw.to_string());
    }
    let host_port = if raw.contains(';') || raw.contains('=') {
        // https wins, then http, then socks (mapped to socks5h: names are
        // looked up at the proxy).
        ["https=", "http=", "socks="].iter().find_map(|protocol| {
            raw.split(';')
                .map(str::trim)
                .find_map(|entry| entry.strip_prefix(protocol).map(str::to_string))
        })?
    } else {
        raw.to_string()
    };
    if host_port.is_empty() {
        return None;
    }
    if raw
        .split(';')
        .any(|entry| entry.trim().starts_with("socks="))
    {
        return Some(format!("socks5h://{host_port}"));
    }
    Some(format!("http://{host_port}"))
}

/// Where requests go now, for an error message: the route and the proxy,
/// its credentials masked.
pub fn proxy_display() -> String {
    let route = current_route();
    let proxy = match &route {
        Route::System => system_proxy(),
        Route::Direct => None,
        Route::Via(url) => Some(url.clone()),
    };
    let proxy = match proxy {
        None => "none (direct)".to_string(),
        Some(url) => match reqwest::Url::parse(&url) {
            Ok(mut parsed) => {
                if !parsed.username().is_empty() {
                    let _ = parsed.set_username("***");
                    let _ = parsed.set_password(Some("***"));
                }
                parsed.to_string()
            }
            Err(_) => url,
        },
    };
    let route = match route {
        Route::System => "system",
        Route::Direct => "direct",
        Route::Via(_) => "manual",
    };
    format!("{route}: {proxy}")
}

fn builder() -> reqwest::ClientBuilder {
    with_timeouts(reqwest::Client::builder())
}

fn streaming_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(STREAM_READ_TIMEOUT)
}

/// `builder` through the proxy in effect ([`proxy_url`]), or else direct:
/// reqwest's own reading of the environment never decides.
pub(crate) fn route(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    match proxy() {
        Some(proxy) => builder.proxy(proxy),
        None => builder.no_proxy(),
    }
}

fn with_proxy(build: impl Fn() -> reqwest::ClientBuilder) -> reqwest::Client {
    route(build()).build().unwrap_or_default()
}

/// The client every whole-body provider request uses. Falls back to a direct
/// (still timed-out) client if the stored proxy fails to build.
pub(crate) fn client() -> reqwest::Client {
    with_proxy(builder)
}

/// The client for SSE-streamed agent requests: no total timeout, only the
/// per-read idle timeout.
pub(crate) fn streaming_client() -> reqwest::Client {
    with_proxy(streaming_builder)
}

/// The configured proxy, for a client that sets up the rest itself. A model
/// on this computer (Ollama, LM Studio) is reached directly, as the app's
/// other requests reach it (net.rs).
pub(crate) fn proxy() -> Option<reqwest::Proxy> {
    proxy_for(&proxy_url()?).ok()
}

/// A proxy for every request to `url`, the loopback family left direct.
pub fn proxy_for(url: &str) -> Result<reqwest::Proxy, String> {
    Ok(reqwest::Proxy::all(url)
        .map_err(|e| e.to_string())?
        .no_proxy(reqwest::NoProxy::from_string(LOOPBACK_NO_PROXY)))
}

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

/// Reassembles `data:` lines from raw SSE chunks, whose boundaries can land
/// mid-character, so bytes are buffered and only complete lines decoded.
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

/// Whether `data` is a stream-ending payload (`[DONE]`, `message_stop`,
/// `response.completed`/`failed`/`incomplete`). A server may keep the
/// connection open past it, so the stream stops here.
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

/// Consumes an SSE body, calling `on_data` with each complete `data:` payload.
/// Returns the error body as Err when the status isn't a success.
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

    #[test]
    fn the_system_proxy_is_read_with_its_credentials() {
        // The environment is read first, as the system's settings are.
        std::env::set_var("HTTPS_PROXY", "http://ann:pw@proxy.example:3128");
        let found = system_proxy_now();
        std::env::remove_var("HTTPS_PROXY");
        assert_eq!(found.as_deref(), Some("http://ann:pw@proxy.example:3128/"));
    }

    #[test]
    fn a_windows_proxy_server_value_is_normalized() {
        // The two shapes the IE settings carry, and the traps: the
        // per-protocol form (https wins, then http), a value without a
        // port, and one with a scheme already.
        assert_eq!(
            parse_windows_proxy_server("192.168.10.5:8080").as_deref(),
            Some("http://192.168.10.5:8080")
        );
        assert_eq!(
            parse_windows_proxy_server("proxy.company.com:8080").as_deref(),
            Some("http://proxy.company.com:8080")
        );
        assert_eq!(
            parse_windows_proxy_server("http=10.0.0.2:81;https=10.0.0.2:444").as_deref(),
            Some("http://10.0.0.2:444")
        );
        assert_eq!(
            parse_windows_proxy_server("https=10.0.0.2:444;http=10.0.0.2:81").as_deref(),
            Some("http://10.0.0.2:444")
        );
        assert_eq!(
            parse_windows_proxy_server("socks=127.0.0.1:1080").as_deref(),
            Some("socks5h://127.0.0.1:1080")
        );
        assert_eq!(
            parse_windows_proxy_server("http://p.example:3128").as_deref(),
            Some("http://p.example:3128")
        );
        assert_eq!(parse_windows_proxy_server(""), None);
        assert_eq!(parse_windows_proxy_server("  "), None);
    }

    #[test]
    fn a_winhttp_proxy_answer_is_parsed() {
        // PAC results come as "PROXY ..." lists ending in DIRECT, or a
        // SOCKS entry; per-protocol and bare values delegate to the
        // ProxyServer parsing.
        assert_eq!(
            parse_winhttp_proxy("PROXY 192.168.1.1:8080").as_deref(),
            Some("http://192.168.1.1:8080")
        );
        assert_eq!(
            parse_winhttp_proxy("PROXY p1.example:80, PROXY p2.example:80; DIRECT").as_deref(),
            Some("http://p1.example:80")
        );
        assert_eq!(
            parse_winhttp_proxy("SOCKS 127.0.0.1:1080").as_deref(),
            Some("socks5h://127.0.0.1:1080")
        );
        assert_eq!(
            parse_winhttp_proxy("http=10.0.0.2:81;https=10.0.0.2:444").as_deref(),
            Some("http://10.0.0.2:444")
        );
        assert_eq!(
            parse_winhttp_proxy("10.0.0.2:8080").as_deref(),
            Some("http://10.0.0.2:8080")
        );
        assert_eq!(parse_winhttp_proxy("DIRECT"), None);
        assert_eq!(parse_winhttp_proxy("direct"), None);
        assert_eq!(parse_winhttp_proxy(""), None);
    }

    #[test]
    fn the_proxy_message_masks_its_credentials() {
        set_route(Route::Via("http://ann:pw@proxy.example:3128".into())).unwrap();
        let shown = proxy_display();
        set_route(Route::Direct).unwrap();
        assert!(
            shown.contains("manual: http://***:***@proxy.example:3128/"),
            "{shown}"
        );
    }

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
