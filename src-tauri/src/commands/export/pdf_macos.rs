
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
    let webview = unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };

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
