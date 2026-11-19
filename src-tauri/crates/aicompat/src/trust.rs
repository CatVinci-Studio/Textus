//! The certificates a request trusts: the bundled Mozilla set, and those
//! installed on this computer - a company's own root, which a proxy that
//! re-signs TLS presents. The system's are read once: on a Mac that takes
//! tens of milliseconds, too long for every client.

use std::sync::OnceLock;

/// The system's certificates the TLS stack takes: one it can't parse would
/// fail the whole client, so it is left out here.
fn system_roots() -> &'static [reqwest::Certificate] {
    static ROOTS: OnceLock<Vec<reqwest::Certificate>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        rustls_native_certs::load_native_certs()
            .certs
            .into_iter()
            .filter(|der| rustls::RootCertStore::empty().add(der.clone()).is_ok())
            .filter_map(|der| reqwest::Certificate::from_der(&der).ok())
            .collect()
    })
}

/// `builder` trusting the system's certificates besides the bundled ones.
pub fn trusted(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    system_roots()
        .iter()
        .cloned()
        .fold(builder, |builder, cert| builder.add_root_certificate(cert))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_trusting_the_system_builds() {
        assert!(trusted(reqwest::Client::builder()).build().is_ok());
        // Read once, kept for every client after.
        assert!(std::ptr::eq(system_roots(), system_roots()));
    }
}
