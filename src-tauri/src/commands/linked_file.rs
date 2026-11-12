//! A local file a document links to, opened the way the system would - or,
//! for one it would run, only shown in its folder.

/// Kinds of file the system would run rather than show: a link to one is
/// only shown in its folder, whatever the document asked for.
const RUNNABLE: &[&str] = &[
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "scr",
    "pif",
    "cpl",
    "msc",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "reg",
    "lnk",
    "url",
    "jar",
    "sh",
    "bash",
    "zsh",
    "fish",
    "csh",
    "command",
    "tool",
    "app",
    "pkg",
    "run",
    "bin",
    "appimage",
    "desktop",
    "py",
    "pyw",
    "pl",
    "rb",
    "php",
    "scpt",
    "applescript",
    "workflow",
    "action",
    "terminal",
    "fileloc",
    "inetloc",
    "webloc",
    "dmg",
    "mpkg",
    "appref-ms",
    "jnlp",
    "chm",
    "msp",
    "settingcontent-ms",
    "library-ms",
    "searchconnector-ms",
    "appinstaller",
    "appx",
    "appxbundle",
    "msix",
    "msixbundle",
    "application",
    "inf",
    "wsc",
    "gadget",
    "xll",
    "iso",
    "img",
    "vhd",
    "vhdx",
    "diagcab",
    "mobileconfig",
    "prefpane",
    "saver",
    "kext",
    "deb",
    "rpm",
    "flatpakref",
];

fn is_runnable(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| RUNNABLE.contains(&ext.to_ascii_lowercase().as_str()))
}

/// A file with no extension its owner may run (a script cloned with its
/// +x bit): the system would run it in a terminal.
fn marked_to_run(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.extension().is_none()
            && std::fs::metadata(path)
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

/// A local file a document links to, opened in the app the system picks for
/// it, after the user agreed in the editor; one the system would run is only
/// shown in its folder.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_linked_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    // What it is, not what it is called: a link named notes.txt may lead to
    // a script, and a file with no extension marked to run opens in a
    // terminal.
    let real = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone().into());
    let real_name = real.to_string_lossy();
    if is_runnable(&path) || is_runnable(&real_name) || marked_to_run(&real) || real.is_dir() {
        opener.reveal_item_in_dir(&path)
    } else {
        opener.open_path(&path, None::<&str>)
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod linked_file_tests {
    use super::is_runnable;

    #[test]
    fn programs_and_scripts_are_only_shown() {
        for path in [
            "C:\\x\\setup.EXE",
            "/tmp/run.sh",
            "/Applications/A.app",
            "a.ps1",
        ] {
            assert!(is_runnable(path), "{path}");
        }
        for path in [
            "D:/论文/原文.pdf",
            "/tmp/notes.docx",
            "/tmp/photo.png",
            "/tmp/noext",
        ] {
            assert!(!is_runnable(path), "{path}");
        }
    }
}
