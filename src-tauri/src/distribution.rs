//! Which channel installed this build, set at compile time by
//! TEXTUS_DISTRIBUTION (`direct` default, `homebrew`, `aur`). Outside `direct`
//! a package manager owns the files, so the app only reports new versions.

const DISTRIBUTION: &str = match option_env!("TEXTUS_DISTRIBUTION") {
    Some(value) => value,
    None => "direct",
};

// A typo such as TEXTUS_DISTRIBUTION=arch would otherwise ship a package
// build that still updates itself. Fail the build instead.
const _: () = {
    let ok = matches!(DISTRIBUTION.as_bytes(), b"direct" | b"homebrew" | b"aur");
    assert!(
        ok,
        "TEXTUS_DISTRIBUTION must be one of: direct, homebrew, aur"
    );
};

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn app_distribution() -> &'static str {
    DISTRIBUTION
}
