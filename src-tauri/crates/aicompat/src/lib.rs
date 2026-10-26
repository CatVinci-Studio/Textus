//! Provider-agnostic OAuth and API client logic for Textus's AI features.
//! No Tauri here, so the same code can run outside the desktop app.

pub mod agent;
pub mod capabilities;
pub mod http;
pub mod images;
pub mod models;
pub mod oauth_page;
pub mod pkce;
pub mod providers;
pub mod public_address;
pub mod responses_api;

pub use oauth_page::success_page_html;

#[cfg(test)]
pub(crate) fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

#[cfg(test)]
mod tests {
    /// Keeps the crate usable outside the desktop app.
    #[test]
    fn depends_on_no_tauri_crate() {
        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest
            .lines()
            .any(|line| line.trim_start().starts_with("tauri")));
    }
}
