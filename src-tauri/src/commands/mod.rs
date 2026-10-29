//! Commands invoked by the frontend. Shared by desktop and iOS unless gated:
//! `#[cfg(desktop)]` modules are about OS windows or the desktop shell (and
//! `tree_ops`, also `#[cfg(desktop)]`); `documents` is `#[cfg(mobile)]`.

pub mod args;
pub mod attachment;
#[cfg(desktop)]
pub mod chat_window;
#[cfg(desktop)]
pub mod cli;
#[cfg(desktop)]
pub mod clipboard;
#[cfg(desktop)]
pub mod default_editor;
#[cfg(mobile)]
pub mod documents;
pub mod drafts;
pub mod export;
pub mod folder;
pub mod fs;
pub mod image_host;
pub mod input_source;
pub mod links;
pub mod own_notes;
#[cfg(desktop)]
pub mod pdf_page_numbers;
#[cfg(desktop)]
pub mod prefs;
pub mod recents;
#[cfg(desktop)]
pub mod session;
pub mod system_info;
pub mod theme_gallery;
pub mod themes;
#[cfg(desktop)]
pub mod tree_ops;
#[cfg(desktop)]
pub mod update;
pub mod vault;
#[cfg(desktop)]
pub mod web_page;
pub mod word_import;
