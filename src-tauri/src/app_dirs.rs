//! The app's own folders: Tauri's per-user ones, or the portable build's
//! beside its program (distribution::portable_root). Every store asks here.

use std::path::PathBuf;
use tauri::{path::PathResolver, Runtime};

pub trait AppDirs {
    fn own_config_dir(&self) -> tauri::Result<PathBuf>;
    fn own_data_dir(&self) -> tauri::Result<PathBuf>;
    fn own_cache_dir(&self) -> tauri::Result<PathBuf>;
}

impl<R: Runtime> AppDirs for PathResolver<R> {
    fn own_config_dir(&self) -> tauri::Result<PathBuf> {
        portable("config").map_or_else(|| self.app_config_dir(), Ok)
    }
    fn own_data_dir(&self) -> tauri::Result<PathBuf> {
        portable("data").map_or_else(|| self.app_data_dir(), Ok)
    }
    fn own_cache_dir(&self) -> tauri::Result<PathBuf> {
        portable("cache").map_or_else(|| self.app_cache_dir(), Ok)
    }
}

fn portable(part: &str) -> Option<PathBuf> {
    crate::distribution::portable_root().map(|root| root.join(part))
}
