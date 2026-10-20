//! Provider-agnostic OAuth and API client logic for Textus's AI features.
//!
//! This crate knows nothing about Tauri commands or credential file storage -
//! it just knows how to run a PKCE login against each provider and how to
//! call each provider's completion API. The main app crate wraps this with
//! `#[tauri::command]`s and decides where credentials get persisted.

pub mod agent;
pub mod capabilities;
pub mod http;
pub mod models;
pub mod oauth_login;
pub mod oauth_page;
pub mod oauth_server;
pub mod pkce;
pub mod providers;
pub mod responses_api;

pub use oauth_login::{run_pkce_login, PkceLoginRequest};
pub use oauth_page::success_page_html;
