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
    // Windows: the installer's folders, for each user or for everyone.
    for base in ["LOCALAPPDATA", "ProgramFiles"] {
        if let Ok(dir) = std::env::var(base) {
            candidates.push(PathBuf::from(dir).join("Pandoc").join("pandoc.exe"));
        }
    }
    candidates
}

/// The fixed places, then the login shell's PATH (Nix, conda…), which an
/// app opened from the Dock lacks: asking it can take seconds.
#[cfg(desktop)]
fn pandoc_places() -> impl Iterator<Item = PathBuf> {
    let login = std::iter::once_with(|| {
        crate::mcp::path::find_program("pandoc", &crate::mcp::path::login_path())
    })
    .flatten();
    pandoc_candidates().into_iter().chain(login)
}

/// Pandoc started without a console window flashing up (Windows).
#[cfg(desktop)]
fn pandoc_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Returns the path of a working pandoc binary, or None. GUI apps launched
/// from Finder lack the shell's PATH, so the usual install locations are probed.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn detect_pandoc() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        for candidate in pandoc_places() {
            let works = pandoc_command(&candidate)
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
/// commonmark_x trimmed to the editor's dialect (no smart quotes or `:::`);
/// the editor's `~sub~` and `^sup^` arrive as spans the Lua filter turns.
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

/// The first of the user's Pandoc arguments the export keeps for itself
/// (`--output`, `--from`, `--to`, an input file), or None.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn check_pandoc_args(args: Vec<String>) -> Option<String> {
    pandoc_options::owned_arg(&args).map(str::to_string)
}

/// Pandoc's extension for a single newline: a line break where the
/// document's folder shows one (its `.textus` conventions), else nothing.
#[cfg(desktop)]
fn breaks_extension(folder: Option<&str>) -> &'static str {
    match folder {
        Some(dir) if crate::conventions::soft_breaks_show(Path::new(dir)) => "+hard_line_breaks",
        _ => "",
    }
}

/// The Word template to hand Pandoc: one since moved or deleted leaves
/// Pandoc's own styles.
#[cfg(desktop)]
fn usable_reference_doc(path: Option<String>) -> Option<String> {
    path.filter(|p| Path::new(p).is_file())
}

/// Converts the document text to `format` via a user-installed pandoc, through
/// stdin; --resource-path lets relative images resolve. The user's arguments
/// come first, so the export's own win; none is passed through a shell.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
#[allow(clippy::too_many_arguments)]
pub async fn export_via_pandoc(
    pandoc_path: String,
    markdown: String,
    output_path: String,
    format: String,
    resource_dir: Option<String>,
    title: String,
    reference_doc: Option<String>,
    options: pandoc_options::PandocOptions,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Only a Pandoc found where detect_pandoc looks: the page names
        // which, never a program of its own.
        if !pandoc_places().any(|c| c.to_string_lossy() == pandoc_path) {
            return Err(format!("{pandoc_path} isn't a Pandoc Textus found."));
        }
        if let Some(arg) = pandoc_options::owned_arg(&options.extra_args) {
            return Err(format!("The Pandoc argument {arg} is set by Textus."));
        }
        let mut args = pandoc_args(&format, &title);
        args[1].push_str(breaks_extension(resource_dir.as_deref()));
        let filter = pandoc_options::lua_filter().map_err(|e| e.to_string())?;
        let mut cmd = pandoc_command(&pandoc_path);
        cmd.arg("--lua-filter")
            .arg(filter.path())
            .args(&options.extra_args)
            .args(args)
            .args(pandoc_options::settings_args(&options))
            .arg("--output")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = &resource_dir {
            cmd.arg("--resource-path").arg(dir);
            cmd.current_dir(dir);
        }
        if let Some(doc) = usable_reference_doc(reference_doc) {
            cmd.arg("--reference-doc").arg(doc);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        // Pandoc may stop reading early (a bad argument): its own message
        // then says why, not the broken pipe the write sees.
        let written = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open pandoc stdin".to_string())?
            .write_all(markdown.as_bytes());
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        written.map_err(|e| e.to_string())?;
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
    if let Some(target) = take_cli_export_target() {
        return Some(target);
    }
    crate::dialogs::save_file(window, default_name, None, (filter_name, ext)).await
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
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(crate::errors::error("pdfTimeout")),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err(crate::errors::error("pdfFailed"))
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
    Err(crate::errors::error("pdfUnsupported"))
}

#[cfg(any(windows, target_os = "linux"))]
mod pdf_offscreen;

#[cfg(target_os = "macos")]
mod pdf_macos;

mod pandoc_options;

#[cfg(all(test, desktop))]
mod tests;
