fn main() {
    // src/distribution.rs reads this with option_env!. Without this line a
    // cached build would keep the channel of whichever build ran first.
    println!("cargo:rerun-if-env-changed=TEXTUS_DISTRIBUTION");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/media/dictation.m")
            .flag("-fobjc-arc")
            .compile("textus_dictation");
        println!("cargo:rustc-link-lib=framework=Speech");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rerun-if-changed=src/media/dictation.m");
    }
    tauri_build::build()
}
