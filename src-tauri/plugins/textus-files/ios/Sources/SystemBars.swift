import UIKit
import WebKit

// The status bar and the home indicator, as other iPhone apps have them: the
// home indicator fades once the screen is left alone, and an iPhone on its
// side shows no status bar - the app's window controller (tao's) asks for
// one always, which kept it drawn over the page's top row in landscape.
final class SystemBars {
  private weak var webview: WKWebView?
  private var boundsObservation: NSKeyValueObservation?

  init(webview: WKWebView) {
    self.webview = webview
    boundsObservation = webview.superview?.layer.observe(\.bounds) {
      [weak self] _, _ in
      DispatchQueue.main.async { self?.update() }
    }
    DispatchQueue.main.async { self.update() }
  }

  deinit { boundsObservation?.invalidate() }

  private func update() {
    guard let controller = webview?.window?.rootViewController else { return }
    set(controller, "setPrefersHomeIndicatorAutoHidden:", true)
    let compact = controller.traitCollection.verticalSizeClass == .compact
    set(controller, "setPrefersStatusBarHidden:", compact)
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
