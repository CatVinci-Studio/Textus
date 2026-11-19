import UIKit
import WebKit

// The status bar and the home indicator, as other iPhone apps have them: the
// home indicator fades once the screen is left alone, and an iPhone on its
// side shows no status bar - the app's window controller (tao's) asks for
// one always, which kept it drawn over the page's top row in landscape.
//
// And what the page keeps clear of at each edge: the page can't tell which
// way the phone is turned (WebKit says portrait whichever way), and UIKit
// gives both sides the camera's depth; only the camera's side keeps it.
final class SystemBars {
  private weak var webview: WKWebView?
  private var boundsObservation: NSKeyValueObservation?
  private var loadObservation: NSKeyValueObservation?

  init(webview: WKWebView) {
    self.webview = webview
    // A page loaded after the last turn hears it again.
    loadObservation = webview.observe(\.isLoading) { [weak self] view, _ in
      if !view.isLoading { DispatchQueue.main.async { self?.update() } }
    }
    watchTurns()
    DispatchQueue.main.async { self.update() }
  }

  deinit {
    boundsObservation?.invalidate()
    loadObservation?.invalidate()
  }

  /// The web view may not be in its host yet when the plugin loads.
  private func watchTurns() {
    guard boundsObservation == nil else { return }
    guard let host = webview?.superview else {
      DispatchQueue.main.async { [weak self] in self?.watchTurns() }
      return
    }
    boundsObservation = host.layer.observe(\.bounds) { [weak self] _, _ in
      DispatchQueue.main.async { self?.update() }
    }
  }

  private func update() {
    guard let webview = webview, let window = webview.window,
      let controller = window.rootViewController
    else { return }
    set(controller, "setPrefersHomeIndicatorAutoHidden:", true)
    let compact = controller.traitCollection.verticalSizeClass == .compact
    set(controller, "setPrefersStatusBarHidden:", compact)
    tellInsets(window)
  }

  /// A phone on its side can go on giving its upright insets (the camera's
  /// depth at the top), or that depth at both sides: it goes to the
  /// camera's side only. Turned with the home indicator at the right
  /// (landscapeRight), the camera is at the left. The other side keeps
  /// what UIKit keeps at the foot for the screen's rounded corners, so the
  /// buttons there stay clear of the corner. An iPad's stay as given.
  private func tellInsets(_ window: UIWindow) {
    let safe = window.safeAreaInsets
    var top = safe.top
    var left = safe.left
    var right = safe.right
    if UIDevice.current.userInterfaceIdiom == .phone,
      let turn = window.windowScene?.interfaceOrientation, turn.isLandscape
    {
      let depth = max(top, left, right)
      let corner = safe.bottom
      top = 0
      left = turn == .landscapeRight ? depth : corner
      right = turn == .landscapeLeft ? depth : corner
    }
    let insets = "{top:\(top),right:\(right),bottom:\(safe.bottom),left:\(left)}"
    // Kept too for a page that hasn't started listening yet.
    webview?.evaluateJavaScript(
      "window.textusInsets = \(insets); window.dispatchEvent(new CustomEvent('textus-insets'))")
  }

  /// The controller's setter for one of its BOOL preferences, where it has
  /// one; each asks UIKit to update the bars itself.
  private func set(_ controller: UIViewController, _ name: String, _ on: Bool) {
    let selector = NSSelectorFromString(name)
    guard controller.responds(to: selector) else { return }
    typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
    let setter = unsafeBitCast(controller.method(for: selector), to: Setter.self)
    setter(controller, selector, on)
  }
}
