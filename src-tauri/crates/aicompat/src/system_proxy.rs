//! Where the system's proxy is found: the environment, the settings each
//! OS keeps, and (Windows) an automatic-configuration script or one
//! discovered by WPAD - read like the browser reads them, so an intranet
//! that only reaches the internet through a proxy works for Textus too.

use crate::http::{current_route, Route};
use std::time::Duration;

/// The system's proxy for web requests, read again after a few seconds so
/// a proxy switched on while Textus runs is followed. One proxy for all:
/// the system's bypass list isn't read; this computer is always direct.
pub(crate) fn system_proxy() -> Option<String> {
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
    // The Windows settings carry the proxy in forms hyper-util's
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
/// reads the same setting and works.
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
/// so the result (including "none") is kept for five minutes.
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
    let config_url_wide = config_url.as_deref().map(wide);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::set_route;

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
}
