import PDFKit
import UIKit
import WebKit

// File > Export as PDF on iOS: the Mac's way (commands/export/pdf_macos.rs).
// The paginated page is loaded in a web view at the paper's width, zoomed to
// 96 CSS px an inch (3/4 pt each), rendered with createPDF a stretch of
// whole sheets at a time, and PDFKit cuts each stretch into sheets.

struct PdfSheetArgs: Decodable {
  let width: Double
  let height: Double
}

struct PdfExportArgs: Decodable {
  let html: String
  let baseDir: String?
  let outputPath: String
  let sheet: PdfSheetArgs
}

private let pageZoom: CGFloat = 0.75

// Fonts and pictures settled, or the PDF takes fallback glyphs; then the
// page's height in CSS px.
private let settleJs = """
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(i =>
    i.complete ? null : i.decode().catch(() => null)));
  return document.documentElement.scrollHeight;
  """

final class PdfExport: NSObject, WKNavigationDelegate {
  private let args: PdfExportArgs
  private let done: (Result<Void, Error>) -> Void
  private let webview: WKWebView
  private var finished = false
  /// Keeps each export alive until it is written: the delegate is weak.
  private static var running: [PdfExport] = []

  private struct Failed: LocalizedError {
    let errorDescription: String?
  }

  static func start(
    _ args: PdfExportArgs, in window: UIWindow?, done: @escaping (Result<Void, Error>) -> Void
  ) {
    let export = PdfExport(args, done: done)
    running.append(export)
    // In the window, out of sight: a web view in no window isn't drawn.
    export.webview.frame.origin = CGPoint(x: -args.sheet.width * 4, y: 0)
    window?.addSubview(export.webview)
    let base = args.baseDir.map { URL(fileURLWithPath: $0, isDirectory: true) }
    export.webview.loadHTMLString(args.html, baseURL: base)
  }

  private init(_ args: PdfExportArgs, done: @escaping (Result<Void, Error>) -> Void) {
    self.args = args
    self.done = done
    webview = WKWebView(
      frame: CGRect(x: 0, y: 0, width: args.sheet.width, height: args.sheet.height),
      configuration: WKWebViewConfiguration())
    webview.pageZoom = pageZoom
    super.init()
    webview.navigationDelegate = self
  }

  /// Sheets per createPDF: a PDF page is at most 14400pt tall, and longer
  /// is split at seams that can't be cut into sheets.
  private var sheetsPerRender: Int { max(1, Int(14400 / args.sheet.height)) }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript(settleJs, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let height):
        let tall = (height as? NSNumber)?.doubleValue ?? 0
        let pages = max(1, Int((tall * Double(pageZoom) / self.args.sheet.height).rounded(.up)))
        self.render(pages: pages, rendered: [])
      case .failure(let error):
        self.finish(.failure(error))
      }
    }
  }

  func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
  ) {
    finish(.failure(error))
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    finish(.failure(error))
  }

  private func render(pages: Int, rendered: [Data]) {
    let start = rendered.count * sheetsPerRender
    if start >= pages {
      finish(Result { try write(rendered, pages: pages) })
      return
    }
    let sheets = min(sheetsPerRender, pages - start)
    let config = WKPDFConfiguration()
    config.rect = CGRect(
      x: 0, y: args.sheet.height * Double(start),
      width: args.sheet.width, height: args.sheet.height * Double(sheets))
    webview.createPDF(configuration: config) { result in
      switch result {
      case .success(let data): self.render(pages: pages, rendered: rendered + [data])
      case .failure(let error): self.finish(.failure(error))
      }
    }
  }

  /// Each stretch, one tall page, cut into sheets by moving each copy's media
  /// and crop boxes (PDF space starts at the bottom left).
  private func write(_ rendered: [Data], pages: Int) throws {
    let output = PDFDocument()
    for (chunk, data) in rendered.enumerated() {
      guard let source = PDFDocument(data: data), let tall = source.page(at: 0) else {
        throw Failed(errorDescription: "The rendered PDF couldn't be read.")
      }
      let bounds = tall.bounds(for: .mediaBox)
      let top = bounds.origin.y + bounds.size.height
      let first = chunk * sheetsPerRender
      for i in 0..<min(sheetsPerRender, pages - first) {
        guard let sheet = tall.copy() as? PDFPage else { continue }
        let rect = CGRect(
          x: bounds.origin.x, y: top - args.sheet.height * Double(i + 1),
          width: args.sheet.width, height: args.sheet.height)
        sheet.setBounds(rect, for: .mediaBox)
        sheet.setBounds(rect, for: .cropBox)
        output.insert(sheet, at: output.pageCount)
      }
    }
    guard output.write(toFile: args.outputPath) else {
      throw Failed(errorDescription: "\(args.outputPath) couldn't be written.")
    }
  }

  private func finish(_ result: Result<Void, Error>) {
    guard !finished else { return }
    finished = true
    webview.navigationDelegate = nil
    webview.removeFromSuperview()
    PdfExport.running.removeAll { $0 === self }
    done(result)
  }
}
