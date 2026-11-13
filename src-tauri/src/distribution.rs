//! Which channel installed this build, set at compile time by
//! TEXTUS_DISTRIBUTION (`direct` default, `homebrew`, `aur`, `portable`).
//! Outside `direct` the app only reports new versions: a package manager owns
//! the files, or (portable, Windows) they live where the user unzipped them.

const DISTRIBUTION: &str = match option_env!("TEXTUS_DISTRIBUTION") {
    Some(value) => value,
    None => "direct",
};

// A typo such as TEXTUS_DISTRIBUTION=arch would otherwise ship a package
// build that still updates itself. Fail the build instead.
const _: () = {
    let ok = matches!(
        DISTRIBUTION.as_bytes(),
        b"direct" | b"homebrew" | b"aur" | b"portable"
    );
    assert!(
        ok,
        "TEXTUS_DISTRIBUTION must be one of: direct, homebrew, aur, portable"
    );
};

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn app_distribution() -> &'static str {
    DISTRIBUTION
}

/// The portable build's own folder beside its program, `TextusData`: its
/// settings, data and caches, and the webview's, travel with it. None for
/// every other build.
pub fn portable_root() -> Option<std::path::PathBuf> {
    if DISTRIBUTION != "portable" {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("TextusData"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_the_portable_build_keeps_its_folders_beside_it() {
        assert_eq!(super::app_distribution(), "direct");
        assert!(super::portable_root().is_none());
    }
}
