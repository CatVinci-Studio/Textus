use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// A4 in inches; Chromium lays it out at 794 x 1122 CSS px. Keep in step with
/// WINDOWS_PAGE in paginate.ts.
#[cfg(windows)]
const PAGE_WIDTH_IN: f64 = 8.27;
#[cfg(windows)]
const PAGE_HEIGHT_IN: f64 = 11.69;

type Done = Sender<Result<(), String>>;

/// The asset-protocol URL of a local file, as convertFileSrc builds it.
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
    let id = crate::editor_windows::next_window_id();
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
                    crate::editor_windows::end_web_process_with_window(_window);
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

/// The name GTK's file backend gives its printer. WebKit matches it exactly and
/// GTK translates it, so it is looked up through GTK's own catalog.
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
        // Top and bottom margins here, not in CSS: WebKitGTK ignores the CSS top margin
        // and keeps the bottom only while @page is `auto`. The sides are the page's padding.
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
