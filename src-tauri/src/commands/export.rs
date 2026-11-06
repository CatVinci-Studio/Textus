//! Export. Only `export_save_dialog` is shared with iOS; the rest needs
//! processes, desktop webviews or a file manager.

#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::{Command, Stdio};

/// Pandoc is detected, not bundled (it is ~180MB and GPL); the frontend points
/// the user to pandoc.org when it's missing.
#[cfg(desktop)]
fn pandoc_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        // Works when the app inherits a shell PATH (e.g. launched via CLI).
        PathBuf::from("pandoc"),
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/opt/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/pandoc"));
    }
    candidates
}

/// Returns the path of a working pandoc binary, or None. GUI apps launched
/// from Finder lack the shell's PATH, so the usual install locations are probed.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn detect_pandoc() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        for candidate in pandoc_candidates() {
            let works = Command::new(&candidate)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if works {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

/// pandoc's arguments for exporting to `format`, before --output. The reader is
/// commonmark_x trimmed to the editor's dialect (no smart quotes, `~sub~`, or `:::`).
/// Only epub gets the filename as its title, since it refuses to build without one.
#[cfg(desktop)]
fn pandoc_args(format: &str, title: &str) -> Vec<String> {
    let title_key = if format == "epub" {
        "title"
    } else {
        "pagetitle"
    };
    vec![
        "--from".into(),
        "commonmark_x-smart-subscript-superscript-fancy_lists-definition_lists\
         -fenced_divs-implicit_header_references+autolink_bare_uris"
            .into(),
        "--to".into(),
        format.into(),
        "--standalone".into(),
        "--metadata".into(),
        format!("{title_key}={title}"),
    ]
}

/// Converts the document text to `format` via a user-installed pandoc, through
/// stdin; --resource-path lets relative images resolve.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn export_via_pandoc(
    pandoc_path: String,
    markdown: String,
    output_path: String,
    format: String,
    resource_dir: Option<String>,
    title: String,
    reference_doc: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = pandoc_args(&format, &title);
        if resource_dir
            .as_deref()
            .is_some_and(|d| super::vault::soft_breaks_show(Path::new(d)))
        {
            args[1].push_str("+hard_line_breaks");
        }
        let mut cmd = Command::new(&pandoc_path);
        cmd.args(args)
            .arg("--output")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = &resource_dir {
            cmd.arg("--resource-path").arg(dir);
            cmd.current_dir(dir);
        }
        // A template since moved or deleted leaves Pandoc's own styles.
        if let Some(doc) = reference_doc.filter(|d| Path::new(d).is_file()) {
            cmd.arg("--reference-doc").arg(doc);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or_else(|| "failed to open pandoc stdin".to_string())?
            .write_all(markdown.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Where `textus export` saves, and whether the export has taken it.
static CLI_EXPORT_TARGET: std::sync::Mutex<Option<(String, bool)>> = std::sync::Mutex::new(None);

#[cfg(desktop)]
pub(crate) fn set_cli_export_target(target: Option<String>) {
    *CLI_EXPORT_TARGET.lock().unwrap_or_else(|e| e.into_inner()) = target.map(|t| (t, false));
}

#[cfg(desktop)]
pub(crate) fn cli_export_taken() -> bool {
    CLI_EXPORT_TARGET
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|(_, taken)| *taken)
}

/// The target of a `textus export` waiting for its save dialog, taken once.
fn take_cli_export_target() -> Option<String> {
    let mut target = CLI_EXPORT_TARGET.lock().unwrap_or_else(|e| e.into_inner());
    match target.as_mut() {
        Some((path, taken)) if !*taken => {
            *taken = true;
            Some(path.clone())
        }
        _ => None,
    }
}

/// Save dialog for exports, with the target format's name and extension.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn export_save_dialog(
    window: tauri::WebviewWindow,
    default_name: String,
    filter_name: String,
    ext: String,
) -> Option<String> {
    use super::fs::{window_file_dialog, with_default_extension};
    if let Some(target) = take_cli_export_target() {
        return Some(target);
    }
    tauri::async_runtime::spawn_blocking(move || {
        window_file_dialog(&window)
            .set_file_name(&default_name)
            .add_filter(&filter_name, &[ext.as_str()])
            .blocking_save_file()
            .map(|p| with_default_extension(p.to_string(), &ext))
    })
    .await
    .ok()
    .flatten()
}

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_pandoc_install_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://pandoc.org/installing.html", None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the exported file in Finder, as visible feedback for the export.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn reveal_in_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // `textus export` prints where it saved; no file manager window.
    let from_terminal = CLI_EXPORT_TARGET
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|(target, _)| *target == path);
    if from_terminal {
        return Ok(());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Kinds of file the system would run rather than show: a link to one is
/// only shown in its folder, whatever the document asked for.
#[cfg(desktop)]
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
];

#[cfg(desktop)]
fn is_runnable(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| RUNNABLE.contains(&ext.to_ascii_lowercase().as_str()))
}

/// A local file a document links to, opened in the app the system picks for
/// it, after the user agreed in the editor; one the system would run is only
/// shown in its folder.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_linked_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    if is_runnable(&path) || std::path::Path::new(&path).is_dir() {
        opener.reveal_item_in_dir(&path)
    } else {
        opener.open_path(&path, None::<&str>)
    }
    .map_err(|e| e.to_string())
}

#[cfg(all(test, desktop))]
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

// macOS can't use window.print() (wry's NSPrintPanel flashes and dismisses
// itself) or NSPrintOperation (no @page margins), so WKWebView's createPDF
// renders the paginated page at 1 px = 1 pt and PDFKit cuts it into A4 sheets.
/// Writes the themed, paginated document to a PDF at `output_path`, offscreen
/// with no print dialog. Same text on every variant: it is the generated TS doc.
#[cfg(target_os = "macos")]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn export_pdf_native(
    app: tauri::AppHandle,
    html: String,
    base_dir: Option<String>,
    output_path: String,
    page_numbers: bool,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let target = output_path.clone();
    app.run_on_main_thread(move || {
        pdf_macos::start_pdf_export(html, base_dir, target, tx);
    })
    .map_err(|e| e.to_string())?;
    // Bounded wait so a hung render can never leave the frontend spinner stuck.
    match tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(60)))
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err("PDF export timed out".to_string()),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("PDF export ended without a result".to_string())
        }
    }?;
    add_page_numbers(output_path, page_numbers).await
}

/// Settings › "Page numbers in PDF": numbers the finished file's pages the
/// same way whichever webview rendered it.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
async fn add_page_numbers(output_path: String, page_numbers: bool) -> Result<(), String> {
    if !page_numbers {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        super::pdf_page_numbers::number_pdf_file(std::path::Path::new(&output_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Labels of the hidden windows the Windows/Linux PDF export renders in, never
/// an editor window.
#[cfg(desktop)]
pub const PDF_EXPORT_LABEL_PREFIX: &str = "pdf-export-";

// Windows and Linux render the paginated page offscreen in a hidden window,
// loaded from a temp file since inline images can exceed a data URL's limit.
/// Writes the themed, paginated document to a PDF at `output_path`, offscreen
/// with no print dialog. Same text on every variant: it is the generated TS doc.
#[cfg(any(windows, target_os = "linux"))]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn export_pdf_native(
    app: tauri::AppHandle,
    html: String,
    _base_dir: Option<String>,
    output_path: String,
    page_numbers: bool,
) -> Result<(), String> {
    pdf_offscreen::export(app, html, output_path.clone()).await?;
    add_page_numbers(output_path, page_numbers).await
}

// Any other desktop: none.
/// Writes the themed, paginated document to a PDF at `output_path`, offscreen
/// with no print dialog. Same text on every variant: it is the generated TS doc.
#[cfg(all(desktop, not(any(target_os = "macos", windows, target_os = "linux"))))]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn export_pdf_native(
    _app: tauri::AppHandle,
    _html: String,
    _base_dir: Option<String>,
    _output_path: String,
    _page_numbers: bool,
) -> Result<(), String> {
    Err("PDF export is not supported on this platform".to_string())
}

#[cfg(any(windows, target_os = "linux"))]
mod pdf_offscreen;

#[cfg(target_os = "macos")]
mod pdf_macos;

#[cfg(all(test, desktop))]
mod tests;
