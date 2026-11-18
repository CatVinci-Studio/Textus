import GameController
import WebKit

// Whether a hardware keyboard is connected (an iPad's Magic Keyboard, a
// Bluetooth one): the page can't tell, as no on-screen keyboard comes up to
// shrink it. With one, the page may give a document the keys on its own, as
// on a computer. Told again after every load, for a page that starts over.
final class HardwareKeyboard {
  private weak var webview: WKWebView?
  private var observers: [NSObjectProtocol] = []
  private var loadObservation: NSKeyValueObservation?

  init(webview: WKWebView) {
    self.webview = webview
    let center = NotificationCenter.default
    for name in [Notification.Name.GCKeyboardDidConnect, .GCKeyboardDidDisconnect] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.tell()
        })
    }
    loadObservation = webview.observe(\.isLoading) { [weak self] view, _ in
      if !view.isLoading { DispatchQueue.main.async { self?.tell() } }
    }
    DispatchQueue.main.async { self.tell() }
  }

  deinit {
    loadObservation?.invalidate()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  private func tell() {
    let on = GCKeyboard.coalesced != nil
    webview?.evaluateJavaScript(
      "window.textusHardwareKeyboard = \(on); window.dispatchEvent(new CustomEvent('textus-hardware-keyboard'))"
    )
  }
}
