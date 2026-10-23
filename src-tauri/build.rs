fn main() {
    // src/distribution.rs reads this with option_env!. Without this line a
    // cached build would keep the channel of whichever build ran first.
    println!("cargo:rerun-if-env-changed=TEXTUS_DISTRIBUTION");

    // tauri-build embeds its application manifest (Common Controls 6, which
    // the dialogs and the tray need) in the app only. The test binaries
    // link the same Windows APIs, and without it exit at start with
    // STATUS_ENTRYPOINT_NOT_FOUND - so the same manifest, tauri-build's
    // default, goes into every binary this crate links.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !windows_msvc {
        tauri_build::build();
        return;
    }
    let manifest =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("tauri-build");
}
