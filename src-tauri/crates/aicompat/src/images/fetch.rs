//! Downloading a picture a service left at a URL. The address comes from the
//! service's reply, not from the user, so it is held to more than the
//! request was: HTTPS only, no credentials in it, a redirect only to another
//! such address, no private or loopback address when Textus connects
//! directly (with a proxy, the proxy resolves the name), and a size cap
//! counted while the body arrives, not after. Adapted from the downloader in
//! #221 by Zhuohang Jiang.

use super::sniff::MAX_IMAGE_BYTES;
use super::ImageError;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

/// Whether an address is on the public internet. Conservative: anything
/// reserved, private, shared, link-local, documentation, benchmarking or
/// multicast is not.
pub(crate) fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(v4) => is_public(IpAddr::V4(v4)),
            None => {
                let s = ip.segments();
                // Global unicast (2000::/3), less 6to4, documentation and
                // the special-purpose 2001::/23.
                (s[0] & 0xe000) == 0x2000
                    && s[0] != 0x2002
                    && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
            }
        },
    }
}

/// A test fixture serves its pictures from 127.0.0.1 over plain HTTP; no
/// build outside the tests accepts that.
fn loopback_fixture(url: &reqwest::Url) -> bool {
    cfg!(test)
        && url.scheme() == "http"
        && matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
}

/// Some services (DashScope's OSS links) still write `http://` for a host
/// that serves HTTPS; asked for over HTTPS instead, never fetched as given.
fn upgraded(mut url: reqwest::Url) -> reqwest::Url {
    let oss = url.host_str().is_some_and(|h| h.ends_with(".aliyuncs.com"));
    if url.scheme() == "http" && oss && url.port().is_none() {
        let _ = url.set_scheme("https");
    }
    url
}

pub(crate) fn check_url(url: &reqwest::Url) -> Result<(), String> {
    if loopback_fixture(url) {
        return Ok(());
    }
    if url.scheme() != "https" {
        return Err("it isn't an HTTPS address".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("it carries a user name or password".into());
    }
    match url.host() {
        Some(url::Host::Domain(_)) => Ok(()),
        Some(url::Host::Ipv4(ip)) if is_public(IpAddr::V4(ip)) => Ok(()),
        Some(url::Host::Ipv6(ip)) if is_public(IpAddr::V6(ip)) => Ok(()),
        _ => Err("it isn't a public address".into()),
    }
}

/// Resolves names as usual, and refuses a name that resolves to an address
/// [`is_public`] turns down - what keeps a public-looking host from
/// pointing a download into the user's own network.
struct PublicOnly;

impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let found: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            if found.is_empty() || found.iter().any(|a| !is_public(a.ip())) {
                return Err(format!("{host} doesn't resolve to a public address").into());
            }
            Ok(Box::new(found.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn client() -> reqwest::Client {
    let redirects = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 3 {
            attempt.error("too many redirects")
        } else if let Err(why) = check_url(attempt.url()) {
            attempt.error(format!("redirected to an address refused because {why}"))
        } else {
            attempt.follow()
        }
    });
    let builder = reqwest::Client::builder().redirect(redirects);
    let builder = match crate::http::proxy() {
        Some(proxy) => builder.proxy(proxy),
        None if cfg!(test) => builder,
        None => builder.dns_resolver(Arc::new(PublicOnly)),
    };
    crate::http::with_timeouts(builder)
        .build()
        .unwrap_or_default()
}

/// The picture at `url`, at most [`MAX_IMAGE_BYTES`] of it.
pub(crate) async fn download(url: &str) -> Result<Vec<u8>, ImageError> {
    use futures_util::StreamExt;

    let refused = |why: String| {
        ImageError::Failed(format!(
            "The service sent a picture address Textus won't open ({why})."
        ))
    };
    let url = reqwest::Url::parse(url).map_err(|e| refused(e.to_string()))?;
    let url = upgraded(url);
    check_url(&url).map_err(refused)?;
    let res = client()
        .get(url)
        .send()
        .await
        .map_err(|e| ImageError::Failed(format!("Downloading the picture failed: {e}")))?;
    if !res.status().is_success() {
        return Err(ImageError::Failed(format!(
            "Downloading the picture failed ({})",
            res.status()
        )));
    }
    if res
        .content_length()
        .is_some_and(|n| n > MAX_IMAGE_BYTES as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| ImageError::Failed(format!("Downloading the picture failed: {e}")))?;
        if body.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn too_large() -> ImageError {
    ImageError::Failed(format!(
        "The picture is larger than {} MB.",
        MAX_IMAGE_BYTES / (1024 * 1024)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_special_addresses_are_not_public() {
        for address in [
            "127.0.0.1",
            "10.2.3.4",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "198.18.0.1",
            "224.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(!is_public(address.parse().unwrap()), "{address}");
        }
        assert!(is_public("8.8.8.8".parse().unwrap()));
        assert!(is_public("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn only_public_https_addresses_are_downloaded() {
        let check = |u: &str| check_url(&reqwest::Url::parse(u).unwrap());
        assert!(check("https://cdn.example.com/a.png").is_ok());
        assert!(check("http://cdn.example.com/a.png").is_err());
        assert!(check("https://user:pw@cdn.example.com/a.png").is_err());
        assert!(check("https://10.0.0.8/a.png").is_err());
        assert!(check("https://[::1]/a.png").is_err());
        assert!(check("ftp://cdn.example.com/a.png").is_err());
        assert!(check("file:///etc/passwd").is_err());
    }

    #[test]
    fn an_oss_link_written_as_http_is_fetched_over_https() {
        let url = reqwest::Url::parse("http://x.oss-cn-beijing.aliyuncs.com/a.png?e=1").unwrap();
        assert_eq!(
            upgraded(url).as_str(),
            "https://x.oss-cn-beijing.aliyuncs.com/a.png?e=1"
        );
        let other = reqwest::Url::parse("http://cdn.example.com/a.png").unwrap();
        assert_eq!(upgraded(other).scheme(), "http");
    }
}
