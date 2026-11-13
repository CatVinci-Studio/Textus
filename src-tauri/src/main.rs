// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer draws a blank window on NVIDIA's driver and
    // makes menus and dialogs flash on others, so use the older renderer unless
    // the user set it. Set before any thread exists, which makes set_var sound.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: first statement of main, single-threaded.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    // `textus help`, `textus search ...`: answered and gone before any window.
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    if let Some(code) = textus_lib::cli::entry() {
        std::process::exit(code);
    }
    textus_lib::run()
}
