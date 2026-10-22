//! Export. Only `export_save_dialog` is shared with iOS; everything else is
//! desktop only - pandoc is an external process (iOS cannot spawn one), the
//! PDF renderers are per-desktop-webview, and "reveal in Finder/Explorer"
//! needs a file manager.

#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::path::PathBuf;
#[cfg(desktop)]
use std::process::{Command, Stdio};

/// Pandoc-backed export follows Typora's model: detect a user-installed
/// binary instead of bundling one (pandoc is ~180MB and GPL-licensed; the
/// frontend guides the user to pandoc.org when it's missing).
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
/// from Finder don't inherit the shell's PATH, so beyond a plain `pandoc`
/// lookup this probes the usual install locations (Homebrew, MacPorts, the
/// official installer's /usr/local, ~/.local).
#[cfg(desktop)]
#[tauri::command]
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

/// pandoc's arguments for exporting to `format`, before --output.
///
/// The reader is commonmark_x trimmed to the editor's dialect: it brings
/// bracketed spans and attributes, which the markdown handed over uses for
/// highlights and image widths (pandoc-markdown.ts), plus dollar
/// math, YAML front matter, footnotes, task lists, tables and alerts.
/// Extensions the editor doesn't have are off, so text means what it says
/// in the editor: no smart quotes, no `~sub~` / `^sup^` (Chinese writes
/// ranges as 3~5), no fancy or definition lists, no `:::` divs.
///
/// Only epub gets the filename as its title (it refuses to build without
/// one). Elsewhere a title would print as a heading above the document's
/// own first heading, so the filename is only the page title.
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

/// Converts the current document text to `format` (a pandoc writer name)
/// via a user-installed pandoc. The markdown is piped through stdin - no
/// temp file - and --resource-path points at the document's folder so
/// relative image srcs (Typora-style assets/...) resolve for formats that
/// embed them (docx, epub, odt).
#[cfg(desktop)]
#[tauri::command]
pub async fn export_via_pandoc(
    pandoc_path: String,
    markdown: String,
    output_path: String,
    format: String,
    resource_dir: Option<String>,
    title: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&pandoc_path);
        cmd.args(pandoc_args(&format, &title))
            .arg("--output")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = &resource_dir {
            cmd.arg("--resource-path").arg(dir);
            cmd.current_dir(dir);
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

/// Save dialog for exports - like save_file_dialog but with the target
/// format's name and extension.
#[tauri::command]
pub async fn export_save_dialog(
    window: tauri::WebviewWindow,
    default_name: String,
    filter_name: String,
    ext: String,
) -> Option<String> {
    use super::fs::{window_file_dialog, with_default_extension};
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
pub async fn open_pandoc_install_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://pandoc.org/installing.html", None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the exported file in Finder, so a successful export has visible
/// feedback beyond the dialog closing.
#[cfg(desktop)]
#[tauri::command]
pub async fn reveal_in_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Renders a themed document to a PDF file on macOS. On Windows/Linux the
/// frontend calls window.print() instead; macOS can't, because wry's
/// window.print() there drives a broken NSPrintPanel that flashes and
/// self-dismisses (tauri-apps/wry#713, tauri#6202).
///
/// This does not go through NSPrintOperation at all. The print path lays the
/// page out at a size that depends on the selected printer's imageable area,
/// and never paints an @page margin - so a themed background either stopped
/// in white bands at every page edge, or, with zero margins, text ran flush
/// into each page seam. Instead the frontend lays the document out at A4
/// width with its own page margins (paginate.ts), this renders it with
/// WKWebView's createPDF at exactly 1 CSS px = 1 pt, and PDFKit cuts that one
/// tall page into A4 sheets. WKWebView is main-thread-only, so this
/// dispatches there and waits for the file to be written.
#[cfg(target_os = "macos")]
#[tauri::command]
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

/// Settings › "Page numbers in PDF" (#68): numbers the finished file's
/// pages, the same way whichever webview rendered it
/// (pdf_page_numbers.rs). Off, the export is exactly what the renderer
/// wrote.
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

/// Labels of the hidden windows the Windows/Linux PDF export renders in -
/// never an editor window (chat_window::is_editor_window).
#[cfg(desktop)]
pub const PDF_EXPORT_LABEL_PREFIX: &str = "pdf-export-";

/// Windows and Linux: the same idea as the macOS path - render the themed,
/// already-paginated document offscreen and write the PDF straight to the
/// chosen file, with no print dialog and no printer driver involved - with
/// each platform's own webview API doing the rendering: WebView2's
/// PrintToPdf (Chromium's PDF backend) on Windows, WebKitGTK's print
/// operation writing to a file on Linux. The page loads in a hidden window
/// through the asset protocol, from a temporary file: the document carries
/// its images inline, which can exceed what a data URL or WebView2's
/// NavigateToString accepts.
#[cfg(any(windows, target_os = "linux"))]
#[tauri::command]
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

#[cfg(all(desktop, not(any(target_os = "macos", windows, target_os = "linux"))))]
#[tauri::command]
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
