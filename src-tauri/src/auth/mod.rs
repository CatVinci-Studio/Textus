pub mod claude;
pub mod custom_endpoint;
pub mod keys;
pub(crate) mod oauth;
pub mod openai_codex;
pub mod pkce_login;

/// Whether a provider's sign-in is kept.
#[derive(serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct AuthStatus {
    pub(crate) configured: bool,
}
