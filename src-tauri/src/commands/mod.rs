//! Commands invoked by the frontend. Shared by desktop and iOS unless gated:
//! the modules below `#[cfg(desktop)]` are about OS windows (the detached
//! chat window, per-window session restore, window-mode prefs) or the desktop
//! shell (the `textus` terminal command, the update check); `documents` (rename and delete
//! for the iPhone's document list) is `#[cfg(mobile)]`. See docs/dev/ios-code-map.md.

pub mod attachment;
#[cfg(desktop)]
pub mod chat_window;
#[cfg(desktop)]
pub mod cli;
#[cfg(mobile)]
pub mod documents;
pub mod drafts;
pub mod export;
pub mod fs;
pub mod image_host;
pub mod links;
#[cfg(desktop)]
pub mod pdf_page_numbers;
#[cfg(desktop)]
pub mod prefs;
pub mod recents;
#[cfg(desktop)]
pub mod session;
pub mod theme_gallery;
pub mod themes;
#[cfg(desktop)]
pub mod update;
