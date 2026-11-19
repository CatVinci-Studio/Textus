use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::sync::mpsc::Sender;

use super::PdfSheet;

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

// The sheet is in points, the web view's own units. createPDF renders one
// view point as 1pt; the page is zoomed to 96 CSS px an inch (3/4 pt each),
// as print lays out on Windows and in browsers, so the document's 16px is
// 12pt. The frontend's page geometry (pdf-page.ts) is this sheet in CSS px.
const PAGE_ZOOM: f64 = 0.75;

// createPDF splits anything taller than a PDF page may be (14400pt, 200 in)
// into more pages, which can't be cut into sheets at the seams; so it is asked
// for this many whole sheets at a time.
fn sheets_per_render(sheet: &PdfSheet) -> usize {
    ((14400.0 / sheet.height) as usize).max(1)
}

// Runs before rendering: fonts and images must settle, or the PDF captures
// fallback glyphs. Returns the document height, in CSS px.
const SETTLE_JS: &str = "await document.fonts.ready; \
        await Promise.all(Array.from(document.images).map(i => \
          i.complete ? null : i.decode().catch(() => null))); \
        return document.documentElement.scrollHeight;";

// Keeps the offscreen webview and its delegate alive until the file is
// written: navigationDelegate is weak.
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
    sheet: PdfSheet,
    // Guards against a second send (a late callback after a failure, say).
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
            self.finish(Err(crate::errors::error("pdfFailed")));
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
                .unwrap_or(0.0);
            let paper = this.ivars().sheet.height;
            let pages = ((height * PAGE_ZOOM / paper).ceil() as usize).max(1);
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
        self.render_from(webview, pages, Vec::new());
    }

    // Renders the next sheets_per_render sheets after those in `rendered`,
    // and writes the file once every sheet is rendered.
    fn render_from(&self, webview: &WKWebView, pages: usize, rendered: Vec<Retained<NSData>>) {
        let sheet = self.ivars().sheet;
        let per_render = sheets_per_render(&sheet);
        let start = rendered.len() * per_render;
        if start >= pages {
            let result = self.write_pages(&rendered, pages);
            self.finish(result);
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            self.finish(Err(crate::errors::error("pdfFailed")));
            return;
        };
        let sheets = per_render.min(pages - start);
        let config = unsafe { WKPDFConfiguration::new(mtm) };
        unsafe {
            config.setRect(CGRect {
                origin: CGPoint::new(0.0, sheet.height * start as f64),
                size: CGSize::new(sheet.width, sheet.height * sheets as f64),
            });
        }
        let this = self.retain();
        let view = webview.retain();
        let rendered = Cell::new(Some(rendered));
        let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            // SAFETY: WebKit passes valid objects when non-null.
            match (unsafe { data.as_ref() }, unsafe { error.as_ref() }) {
                (Some(data), _) => {
                    let mut rendered = rendered.take().unwrap_or_default();
                    rendered.push(data.retain());
                    this.render_from(&view, pages, rendered);
                }
                (None, Some(error)) => this.finish(Err(format!(
                    "Failed to render PDF: {}",
                    error.localizedDescription()
                ))),
                (None, None) => this.finish(Err(crate::errors::error("pdfFailed"))),
            }
        });
        unsafe {
            webview.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
        }
    }

    // Cuts each rendered stretch, one tall page, into sheets by moving each
    // copy's media and crop boxes (PDF space starts at the bottom left).
    fn write_pages(&self, rendered: &[Retained<NSData>], pages: usize) -> Result<(), String> {
        let output = unsafe { PDFDocument::new() };
        let paper = self.ivars().sheet;
        let per_render = sheets_per_render(&paper);
        // Kept until the file is written: the sheets are copies of their pages.
        let mut sources = Vec::with_capacity(rendered.len());
        for (chunk, data) in rendered.iter().enumerate() {
            let source = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), data) }
                .ok_or("Rendered PDF could not be read")?;
            let tall = unsafe { source.pageAtIndex(0) }.ok_or("Rendered PDF is empty")?;
            let bounds = unsafe { tall.boundsForBox(PDFDisplayBox::MediaBox) };
            let top = bounds.origin.y + bounds.size.height;
            let first = chunk * per_render;
            for i in 0..per_render.min(pages - first) {
                let sheet = tall.copy();
                let rect = CGRect {
                    origin: CGPoint::new(bounds.origin.x, top - paper.height * (i + 1) as f64),
                    size: CGSize::new(paper.width, paper.height),
                };
                unsafe {
                    sheet.setBounds_forBox(rect, PDFDisplayBox::MediaBox);
                    sheet.setBounds_forBox(rect, PDFDisplayBox::CropBox);
                    output.insertPage_atIndex(&sheet, first + i);
                }
            }
            sources.push(source);
        }
        let path = NSString::from_str(&self.ivars().output_path);
        if unsafe { output.writeToFile(&path) } {
            Ok(())
        } else {
            Err(format!("Could not write {}", self.ivars().output_path))
        }
    }

    // Sends the one-shot result and drops this export's webview + delegate.
    // Retains self first: removing our own PENDING entry would be a use-after-free.
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
    sheet: PdfSheet,
    tx: Sender<Result<(), String>>,
) {
    let Some(mtm) = MainThreadMarker::new() else {
        let _ = tx.send(Err(crate::errors::error("pdfFailed")));
        return;
    };
    let id = NEXT_ID.with(|next| {
        let id = next.get();
        next.set(id.wrapping_add(1));
        id
    });

    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // The paper width: at the page zoom, the width the frontend laid the
    // document out at.
    let frame = CGRect {
        origin: CGPoint::new(0.0, 0.0),
        size: CGSize::new(sheet.width, sheet.height),
    };
    let webview = unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };
    unsafe { webview.setPageZoom(PAGE_ZOOM) };

    let delegate = {
        let this = mtm.alloc::<PdfExporter>().set_ivars(PdfExporterIvars {
            id,
            output_path,
            result_tx: tx,
            sheet,
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
