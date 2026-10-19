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
mod pdf_offscreen {
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Sender};
    use std::sync::Arc;

    use tauri::webview::PageLoadEvent;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    /// A4 in inches; with scale 1 and no margins Chromium lays it out at
    /// 794 x 1122 CSS px - WINDOWS_PAGE in export/paginate.ts, which
    /// paginates the document at that size. Change both together.
    #[cfg(windows)]
    const PAGE_WIDTH_IN: f64 = 8.27;
    #[cfg(windows)]
    const PAGE_HEIGHT_IN: f64 = 11.69;

    type Done = Sender<Result<(), String>>;

    /// The asset-protocol URL of a local file - what the frontend's
    /// convertFileSrc builds: the whole path as one percent-encoded segment.
    fn asset_url(path: &Path) -> Result<WebviewUrl, String> {
        let raw = path.to_string_lossy();
        let mut encoded = String::with_capacity(raw.len() * 3);
        for byte in raw.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char)
                }
                _ => encoded.push_str(&format!("%{byte:02X}")),
            }
        }
        #[cfg(windows)]
        let url = format!("http://asset.localhost/{encoded}");
        #[cfg(not(windows))]
        let url = format!("asset://localhost/{encoded}");
        tauri::Url::parse(&url)
            .map(webview_url)
            .map_err(|e| e.to_string())
    }

    /// WebView2 serves custom schemes as http://<scheme>.localhost, which
    /// Tauri only accepts as an external URL.
    #[cfg(windows)]
    fn webview_url(url: tauri::Url) -> WebviewUrl {
        WebviewUrl::External(url)
    }

    #[cfg(not(windows))]
    fn webview_url(url: tauri::Url) -> WebviewUrl {
        WebviewUrl::CustomProtocol(url)
    }

    pub async fn export(
        app: tauri::AppHandle,
        html: String,
        output_path: String,
    ) -> Result<(), String> {
        let id = crate::next_window_id();
        // Removed when `page` drops, however this returns.
        let page = crate::atomic::TempFile::create("textus-pdf-export-", ".html", html)
            .map_err(|e| e.to_string())?;
        let label = format!("{}{id}", super::PDF_EXPORT_LABEL_PREFIX);

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let started = Arc::new(AtomicBool::new(false));
        let built = {
            let tx = tx.clone();
            let output_path = output_path.clone();
            asset_url(page.path()).and_then(|url| {
                WebviewWindowBuilder::new(&app, &label, url)
                    .title("PDF")
                    .visible(false)
                    .skip_taskbar(true)
                    .inner_size(794.0, 1123.0)
                    .on_page_load(move |window, payload| {
                        // Once: a page can report Finished more than once.
                        if payload.event() != PageLoadEvent::Finished
                            || started.swap(true, Ordering::SeqCst)
                        {
                            return;
                        }
                        render_to_file(&window, &output_path, tx.clone());
                    })
                    .build()
                    .inspect(|_window| {
                        #[cfg(target_os = "linux")]
                        crate::end_web_process_with_window(_window);
                    })
                    .map_err(|e| e.to_string())
            })
        };

        let result = match built {
            Err(e) => Err(e),
            Ok(_) => {
                // Bounded, so a render that never reports back can't leave the
                // frontend's progress overlay up forever.
                match tokio::task::spawn_blocking(move || {
                    rx.recv_timeout(std::time::Duration::from_secs(60))
                })
                .await
                {
                    Ok(Ok(result)) => result,
                    Ok(Err(_)) => Err("PDF export timed out".to_string()),
                    Err(e) => Err(e.to_string()),
                }
            }
        };
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        // After the window that had it loaded is gone.
        drop(page);
        result
    }

    #[cfg(windows)]
    fn render_to_file(window: &tauri::WebviewWindow, output_path: &str, done: Done) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2_7,
        };
        use webview2_com::PrintToPdfCompletedHandler;
        use windows::core::{Interface, HSTRING};

        let output_path = output_path.to_string();
        let fail = done.clone();
        let scheduled = window.with_webview(move |webview| {
            let start = || -> windows::core::Result<()> {
                // SAFETY: COM calls on the live controller and environment
                // the platform webview hands us, on its own (UI) thread.
                unsafe {
                    let core = webview.controller().CoreWebView2()?;
                    let core: ICoreWebView2_7 = core.cast()?;
                    let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let settings = environment.CreatePrintSettings()?;
                    settings.SetPageWidth(PAGE_WIDTH_IN)?;
                    settings.SetPageHeight(PAGE_HEIGHT_IN)?;
                    settings.SetMarginTop(0.0)?;
                    settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?;
                    settings.SetMarginRight(0.0)?;
                    settings.SetScaleFactor(1.0)?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    let done = done.clone();
                    let handler =
                        PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
                            let _ = done.send(match result {
                                Ok(()) if succeeded => Ok(()),
                                Ok(()) => Err("PDF export failed".to_string()),
                                Err(e) => Err(e.message()),
                            });
                            Ok(())
                        }));
                    core.PrintToPdf(&HSTRING::from(output_path.as_str()), &settings, &handler)
                }
            };
            if let Err(e) = start() {
                let _ = done.send(Err(e.message()));
            }
        });
        if let Err(e) = scheduled {
            let _ = fail.send(Err(e.to_string()));
        }
    }

    /// The name GTK's file backend gives its printer. WebKit picks the
    /// printer by exact name, and GTK translates this one (gtk30's
    /// "Print to File" - "打印到文件" in Chinese), so the English literal
    /// failed with "Printer not found" under every non-English locale
    /// (#62). Looked up through the same catalog GTK names it from.
    #[cfg(target_os = "linux")]
    fn file_printer_name() -> String {
        gtk::glib::dgettext(Some("gtk30"), "Print to File").to_string()
    }

    #[cfg(target_os = "linux")]
    fn render_to_file(window: &tauri::WebviewWindow, output_path: &str, done: Done) {
        use webkit2gtk::{PrintOperation, PrintOperationExt};

        let output_path = output_path.to_string();
        let fail = done.clone();
        let scheduled = window.with_webview(move |webview| {
            let Ok(uri) = gtk::glib::filename_to_uri(&output_path, None) else {
                let _ = done.send(Err(format!("Invalid output path {output_path}")));
                return;
            };
            let operation = PrintOperation::new(&webview.inner());
            // GTK's file backend: the job goes to a PDF file, never a printer,
            // and no dialog is shown because `print()` is not `run_dialog()`.
            let settings = gtk::PrintSettings::new();
            settings.set_printer(&file_printer_name());
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT.as_str(), Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI.as_str(), Some(uri.as_str()));
            let setup = gtk::PageSetup::new();
            setup.set_paper_size(&gtk::PaperSize::new(Some(gtk::PAPER_NAME_A4.as_str())));
            // Top and bottom margins here, not in CSS: WebKitGTK draws every
            // page below this top margin whatever the CSS says, and keeps the
            // bottom one only while the page's @page margin is `auto`
            // (exporters.ts's pdfLayoutCss) - any other value cut taller
            // pages that ran off the sheet (#68). The sides are the page's
            // own padding, ~20mm too.
            setup.set_top_margin(20.0, gtk::Unit::Mm);
            setup.set_bottom_margin(20.0, gtk::Unit::Mm);
            setup.set_left_margin(0.0, gtk::Unit::Mm);
            setup.set_right_margin(0.0, gtk::Unit::Mm);
            operation.set_print_settings(&settings);
            operation.set_page_setup(&setup);
            let finished = done.clone();
            operation.connect_finished(move |_| {
                let _ = finished.send(Ok(()));
            });
            operation.connect_failed(move |_, error| {
                let _ = done.send(Err(error.to_string()));
            });
            operation.print();
        });
        if let Err(e) = scheduled {
            let _ = fail.send(Err(e.to_string()));
        }
    }
}

#[cfg(target_os = "macos")]
mod pdf_macos {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::sync::mpsc::Sender;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadOnly, Message};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{
        MainThreadMarker, NSCopying, NSData, NSError, NSNumber, NSObjectProtocol, NSString, NSURL,
    };
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
    use objc2_web_kit::{
        WKContentWorld, WKNavigation, WKNavigationDelegate, WKPDFConfiguration, WKWebView,
        WKWebViewConfiguration,
    };

    // A4 in PostScript points (1pt = 1/72"); createPDF renders 1 CSS px as 1pt,
    // so this is also the page in CSS px. Mirrored by MAC_PAGE in
    // export/paginate.ts, which lays the document out at this size - change
    // both together.
    const PAPER_WIDTH: f64 = 595.0;
    const PAPER_HEIGHT: f64 = 842.0;

    // Runs in the loaded page before rendering: fonts and images must have
    // settled, or the PDF captures fallback glyphs and empty boxes. Returns
    // the document height, which decides the page count.
    const SETTLE_JS: &str = "await document.fonts.ready; \
        await Promise.all(Array.from(document.images).map(i => \
          i.complete ? null : i.decode().catch(() => null))); \
        return document.documentElement.scrollHeight;";

    // Keeps the offscreen webview and its delegate alive from load until the
    // file is written. navigationDelegate is weak and the dispatch that starts
    // the export returns immediately, so without this the graph would drop
    // mid-flight.
    struct Pending {
        _webview: Retained<WKWebView>,
        _delegate: Retained<PdfExporter>,
    }

    thread_local! {
        static PENDING: RefCell<HashMap<usize, Pending>> = RefCell::new(HashMap::new());
        static NEXT_ID: Cell<usize> = const { Cell::new(0) };
    }

    struct PdfExporterIvars {
        id: usize,
        output_path: String,
        result_tx: Sender<Result<(), String>>,
        // The channel is signalled once; `signalled` guards against a second
        // send (a late navigation callback after a failure, say).
        signalled: Cell<bool>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = PdfExporterIvars]
        struct PdfExporter;

        unsafe impl NSObjectProtocol for PdfExporter {}

        unsafe impl WKNavigationDelegate for PdfExporter {
            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish_navigation(&self, webview: &WKWebView, _navigation: &WKNavigation) {
                self.settle_then_render(webview);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.finish(Err(format!(
                    "Failed to render page: {}",
                    error.localizedDescription()
                )));
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.finish(Err(format!(
                    "Failed to load page: {}",
                    error.localizedDescription()
                )));
            }
        }
    );

    impl PdfExporter {
        fn settle_then_render(&self, webview: &WKWebView) {
            if self.ivars().signalled.get() {
                return;
            }
            let Some(mtm) = MainThreadMarker::new() else {
                self.finish(Err("PDF export left the main thread".to_string()));
                return;
            };
            let this = self.retain();
            let view = webview.retain();
            let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                if !error.is_null() {
                    // SAFETY: WebKit passes a valid NSError when non-null.
                    let message = unsafe { (*error).localizedDescription() };
                    this.finish(Err(format!("Failed to prepare page: {message}")));
                    return;
                }
                // SAFETY: a JS number arrives as an NSNumber.
                let height = unsafe { result.cast::<NSNumber>().as_ref() }
                    .map(|n| n.doubleValue())
                    .unwrap_or(PAPER_HEIGHT);
                let pages = ((height / PAPER_HEIGHT).ceil() as usize).max(1);
                this.render(&view, pages);
            });
            let world = unsafe { WKContentWorld::pageWorld(mtm) };
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(SETTLE_JS),
                    None,
                    None,
                    &world,
                    Some(&handler),
                );
            }
        }

        fn render(&self, webview: &WKWebView, pages: usize) {
            let Some(mtm) = MainThreadMarker::new() else {
                self.finish(Err("PDF export left the main thread".to_string()));
                return;
            };
            let config = unsafe { WKPDFConfiguration::new(mtm) };
            unsafe {
                config.setRect(CGRect {
                    origin: CGPoint::new(0.0, 0.0),
                    size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT * pages as f64),
                });
            }
            let this = self.retain();
            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                // SAFETY: WebKit passes valid objects when non-null.
                let result = match (unsafe { data.as_ref() }, unsafe { error.as_ref() }) {
                    (Some(data), _) => this.write_pages(data, pages),
                    (None, Some(error)) => Err(format!(
                        "Failed to render PDF: {}",
                        error.localizedDescription()
                    )),
                    (None, None) => Err("Failed to render PDF".to_string()),
                };
                this.finish(result);
            });
            unsafe {
                webview.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
            }
        }

        // Cuts the single tall rendered page into A4 sheets. Each sheet is a
        // copy of the tall page with its media and crop boxes moved to one
        // window of it (PDF space starts at the bottom left, so sheet i is
        // counted down from the top).
        fn write_pages(&self, data: &NSData, pages: usize) -> Result<(), String> {
            let source = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), data) }
                .ok_or("Rendered PDF could not be read")?;
            let tall = unsafe { source.pageAtIndex(0) }.ok_or("Rendered PDF is empty")?;
            let bounds = unsafe { tall.boundsForBox(PDFDisplayBox::MediaBox) };
            let top = bounds.origin.y + bounds.size.height;
            let output = unsafe { PDFDocument::new() };
            for i in 0..pages {
                let sheet = tall.copy();
                let rect = CGRect {
                    origin: CGPoint::new(bounds.origin.x, top - PAPER_HEIGHT * (i + 1) as f64),
                    size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT),
                };
                unsafe {
                    sheet.setBounds_forBox(rect, PDFDisplayBox::MediaBox);
                    sheet.setBounds_forBox(rect, PDFDisplayBox::CropBox);
                    output.insertPage_atIndex(&sheet, i);
                }
            }
            let path = NSString::from_str(&self.ivars().output_path);
            if unsafe { output.writeToFile(&path) } {
                Ok(())
            } else {
                Err(format!("Could not write {}", self.ivars().output_path))
            }
        }

        // Sends the one-shot result and drops this export's webview + delegate.
        // Retains self first: the PENDING map holds our only strong reference
        // (the webview points back weakly), and we may be inside a delegate
        // method, so removing our own entry would otherwise be a use-after-free.
        fn finish(&self, result: Result<(), String>) {
            let _keep = self.retain();
            if !self.ivars().signalled.replace(true) {
                let _ = self.ivars().result_tx.send(result);
            }
            let id = self.ivars().id;
            PENDING.with(|pending| {
                pending.borrow_mut().remove(&id);
            });
        }
    }

    pub fn start_pdf_export(
        html: String,
        base_dir: Option<String>,
        output_path: String,
        tx: Sender<Result<(), String>>,
    ) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("PDF export must run on the main thread".to_string()));
            return;
        };
        let id = NEXT_ID.with(|next| {
            let id = next.get();
            next.set(id.wrapping_add(1));
            id
        });

        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        // The paper width: the frontend laid the document out at this width.
        let frame = CGRect {
            origin: CGPoint::new(0.0, 0.0),
            size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT),
        };
        let webview =
            unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };

        let delegate = {
            let this = mtm.alloc::<PdfExporter>().set_ivars(PdfExporterIvars {
                id,
                output_path,
                result_tx: tx,
                signalled: Cell::new(false),
            });
            let this: Retained<PdfExporter> = unsafe { msg_send![super(this), init] };
            this
        };

        let proto = ProtocolObject::from_ref(&*delegate);
        unsafe { webview.setNavigationDelegate(Some(proto)) };

        let ns_html = NSString::from_str(&html);
        let base_url = base_dir
            .as_deref()
            .map(|dir| NSURL::fileURLWithPath(&NSString::from_str(dir)));
        unsafe {
            webview.loadHTMLString_baseURL(&ns_html, base_url.as_deref());
        }

        PENDING.with(|pending| {
            pending.borrow_mut().insert(
                id,
                Pending {
                    _webview: webview,
                    _delegate: delegate,
                },
            );
        });
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::pandoc_args;

    #[test]
    fn pandoc_reads_the_editor_dialect_and_titles_only_epub() {
        let docx = pandoc_args("docx", "notes");
        assert_eq!(docx[0], "--from");
        assert!(docx[1].starts_with("commonmark_x-smart-subscript-superscript"));
        assert!(docx[1].ends_with("+autolink_bare_uris"));
        assert!(!docx[1].contains(char::is_whitespace));
        assert!(docx.contains(&"pagetitle=notes".to_string()));
        assert!(!docx.iter().any(|a| a.starts_with("title=")));
        assert!(pandoc_args("epub", "notes").contains(&"title=notes".to_string()));
    }
}
