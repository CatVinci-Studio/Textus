//! A dragged-out tab handed to its new window in the boot snapshot.

use super::{DetachedTab, PendingDetachedTabs};
use tauri::Manager;

/// Above this a dragged-out tab's text is left to take_detached_tab rather
/// than copied into its window's boot script.
const MAX_BOOT_TAB: usize = 2 * 1024 * 1024;

/// The tab a window being built is handed, for its boot snapshot, so the page
/// shows it from its first frame. It stays pending: the page still takes it,
/// and a reload (which replays the snapshot) finds it gone.
pub fn boot_detached_tab(app: &tauri::AppHandle, label: &str) -> Option<DetachedTab> {
    let pending = app.try_state::<PendingDetachedTabs>()?;
    let tab = pending.0.lock().unwrap().get(label).cloned()?;
    fits_boot(&tab).then_some(tab)
}

fn fits_boot(tab: &DetachedTab) -> bool {
    tab.content.len() + tab.saved_content.len() <= MAX_BOOT_TAB
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(len: usize) -> DetachedTab {
        DetachedTab {
            path: None,
            content: "x".repeat(len),
            saved_content: String::new(),
            disk_mtime: None,
            help_doc: None,
            imported_from: None,
        }
    }

    #[test]
    fn a_large_tab_is_left_out_of_the_boot_script() {
        assert!(fits_boot(&tab(10)));
        assert!(!fits_boot(&tab(MAX_BOOT_TAB + 1)));
    }
}
