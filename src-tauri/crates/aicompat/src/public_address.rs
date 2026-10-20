//! Whether an address is on the public internet - the one check for every
//! URL a model or a service hands Textus to fetch: web_fetch's pages (the
//! app's ai/web/fetch.rs) and the pictures an image service leaves at a URL
//! (images/fetch.rs). Strict: only global unicast passes, so a router's
//! admin page, a cloud metadata service or a dev server on localhost stays
//! out of reach whatever form its address is written in.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Whether `ip` is on the public internet. IPv4: not unspecified ("this
/// network", 0/8), private (10/8, 172.16/12, 192.168/16), loopback, link-
/// local, carrier-grade NAT (100.64/10), IETF assignments (192.0.0/24),
/// documentation, the old 6to4 relay (192.88.99/24), benchmarking
/// (198.18/15), multicast, reserved or broadcast. IPv6: an IPv4-mapped
/// address is judged as the IPv4 address it carries; otherwise only global
/// unicast (2000::/3) passes, less 6to4 (2002::/16), the special-purpose
/// 2001::/23 (Teredo, benchmarking and others) and documentation
/// (2001:db8::/32, 3fff::/20). That leaves out loopback, unspecified,
/// IPv4-compatible, NAT64 (64:ff9b::/96 and /48), unique local, link-local,
/// site-local and multicast, which all lie outside 2000::/3.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => is_public_v6(ip),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (b & 0xc0) == 64)
        || (a == 169 && b == 254)
        || (a == 172 && (b & 0xf0) == 16)
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b & 0xfe) == 18)
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        // Multicast 224/4, reserved 240/4 and broadcast.
        || a >= 224)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let s = ip.segments();
    (s[0] & 0xe000) == 0x2000
        && s[0] != 0x2002
        && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
        && (s[0] & 0xfff0) != 0x3ff0
}

/// Whether every address a name resolved to is public - none at all is
/// not. All of them, not the first: a name answering with one public and
/// one private address would otherwise reach the private one on a retry.
pub fn all_public(addresses: impl IntoIterator<Item = IpAddr>) -> bool {
    let mut any = false;
    for ip in addresses {
        if !is_public(ip) {
            return false;
        }
        any = true;
    }
    any
}

/// Names that mean this machine or the local network, refused before any
/// lookup: a resolver may answer them from the hosts file or mDNS, and a
/// proxy resolves them on its own side.
pub fn is_local_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn private_loopback_and_special_ipv4_addresses_are_not_public() {
        for address in [
            "0.0.0.0",
            "0.1.2.3",
            "10.2.3.4",
            "127.0.0.1",
            "127.8.9.10",
            "100.64.0.1",
            "100.127.255.254",
            "169.254.169.254",
            "172.16.0.1",
            "172.31.255.255",
            "192.0.0.8",
            "192.0.2.1",
            "192.88.99.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.19.255.255",
            "198.51.100.7",
            "203.0.113.9",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
        ] {
            assert!(!is_public(ip(address)), "{address} counted as public");
        }
    }

    #[test]
    fn ipv6_outside_global_unicast_or_carrying_a_private_ipv4_is_not_public() {
        for address in [
            "::",
            "::1",
            // IPv4-mapped and IPv4-compatible forms of private addresses.
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:100.64.0.1",
            "::7f00:1",
            // NAT64, whatever IPv4 address it reaches.
            "64:ff9b::a9fe:a9fe",
            "64:ff9b::808:808",
            "64:ff9b:1::1",
            "fc00::1",
            "fd00::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
            "100::1",
            // 6to4, Teredo, benchmarking, documentation.
            "2002:c0a8:0101::1",
            "2002:0808:0808::1",
            "2001::1",
            "2001:2::1",
            "2001:db8::1",
            "3fff::1",
        ] {
            assert!(!is_public(ip(address)), "{address} counted as public");
        }
    }

    #[test]
    fn public_addresses_are_public() {
        for address in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.215.14",
            "100.63.255.255",
            "100.128.0.1",
            "172.15.255.255",
            "172.32.0.1",
            "::ffff:8.8.8.8",
            "2606:4700:4700::1111",
            "2a00:1450:4001::1",
            "2001:4860:4860::8888",
        ] {
            assert!(is_public(ip(address)), "{address} counted as private");
        }
    }

    /// DNS rebinding: a public-looking name that answers with a private
    /// address, among public ones or alone, is refused.
    #[test]
    fn a_name_is_public_only_if_every_address_it_resolves_to_is() {
        assert!(all_public([ip("1.1.1.1"), ip("2606:4700:4700::1111")]));
        assert!(!all_public([ip("1.1.1.1"), ip("127.0.0.1")]));
        assert!(!all_public([ip("10.0.0.1")]));
        assert!(!all_public([
            ip("2606:4700:4700::1111"),
            ip("::ffff:192.168.0.1")
        ]));
        assert!(!all_public([]));
    }

    #[test]
    fn local_names_are_recognised_before_any_lookup() {
        for host in [
            "localhost",
            "LOCALHOST.",
            "app.localhost",
            "printer.local",
            "metadata.google.internal",
            "nas.home.arpa",
        ] {
            assert!(is_local_name(host), "{host}");
        }
        for host in ["example.com", "localhost.example.com", "local.example"] {
            assert!(!is_local_name(host), "{host}");
        }
    }
}
