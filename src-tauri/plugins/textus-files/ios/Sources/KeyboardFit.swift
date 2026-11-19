import ObjectiveC
import UIKit
import WebKit

// Keeps the web view out from under the on-screen keyboard.
//
// WKWebView does not resize its page for the keyboard: it shrinks the
// visual viewport and scrolls the whole document up to keep the caret in
// view, which carries the app's title row off the top of the screen and
// leaves the page sitting high after the keyboard is gone. Shortening the
// view itself instead means the page is simply a shorter page while the
// keyboard is up, laid out by the same CSS as any other window size.
//
// Lives in this package because it is the app's only native code; the
// plugin starts it from load(webview:).
final class KeyboardFit {
  private weak var webview: WKWebView?
  private var observers: [NSObjectProtocol] = []
  private var offsetObservation: NSKeyValueObservation?
  private var boundsObservation: NSKeyValueObservation?
  /// Where the keyboard last said it would end up, in screen coordinates
  /// (nil: down).
  private var keyboardEnd: CGRect?
  private var toldCovered: CGFloat = -1
  /// The host's shape last laid out: a turn flips it.
  private var wasLandscape: Bool?

  init(webview: WKWebView) {
    self.webview = webview
    // No scroll-into-view of a page that already fits, and no rubber band
    // that leaves the page pulled up under the status bar.
    webview.scrollView.isScrollEnabled = false
    webview.scrollView.bounces = false
    // The page runs under the status bar and the home indicator and keeps
    // clear of them itself (env(safe-area-inset-*)), so its title row and
    // what covers it reach the screen's edges; inset, the strips were the
    // web view's own white.
    webview.scrollView.contentInsetAdjustmentBehavior = .never
    Self.hideFormAccessory(in: webview)
    // The page never scrolls as a whole - everything that scrolls does so
    // inside it - yet raising the keyboard still had WebKit move it: its
    // scroll to the focused field shoved the app, title row and all, about
    // 100pt down for a frame, and the frame animation below slid it back.
    // So the page is held at its resting position whenever anything moves
    // it, before that frame is drawn.
    offsetObservation = webview.scrollView.observe(\.contentOffset) {
      [weak self] scroll, _ in
      self?.hold(scroll)
    }
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: UIResponder.keyboardWillChangeFrameNotification,
        object: nil,
        queue: .main
      ) { [weak self] note in
        self?.keyboardMoved(note)
      })
    // Gone without a frame that says so (put down for a turn, or by the
    // system mid-turn): the page gets its full height back.
    observers.append(
      center.addObserver(
        forName: UIResponder.keyboardDidHideNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.keyboardEnd = nil
        self?.fit(animated: false)
      })
    watchTurns()
    // Coming back from another app the keyboard is re-announced and the
    // page may have drifted; settle it again.
    observers.append(
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.pinToTop()
      })
  }

  /// A turn re-lays out the host after the keyboard has said where it goes:
  /// the gap it leaves is measured again against the new bounds, or the
  /// portrait keyboard's gap stays under a landscape page. The web view may
  /// not be in its host yet when the plugin loads; then once it is.
  private func watchTurns() {
    guard boundsObservation == nil else { return }
    guard let host = webview?.superview else {
      DispatchQueue.main.async { [weak self] in self?.watchTurns() }
      return
    }
    boundsObservation = host.layer.observe(\.bounds) { [weak self] _, _ in
      DispatchQueue.main.async { self?.turned() }
    }
  }

  deinit {
    offsetObservation?.invalidate()
    boundsObservation?.invalidate()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  /// Back to the resting position (pinToTop) if the page was moved from
  /// it. A page pinch-zoomed in is left to pan.
  private func hold(_ scroll: UIScrollView) {
    guard scroll.zoomScale <= scroll.minimumZoomScale + 0.001 else { return }
    let rest = CGPoint(x: 0, y: -scroll.adjustedContentInset.top)
    let offset = scroll.contentOffset
    if abs(offset.y - rest.y) > 0.5 || abs(offset.x - rest.x) > 0.5 {
      scroll.contentOffset = rest
    }
  }

  /// WebKit puts its form-assistant bar (previous / next field and Done)
  /// on top of the keyboard for any focused field. A document editor has no
  /// "next field", and Textus draws its own toolbar there
  /// (mobile/KeyboardToolbar.tsx), so the content view is given a subclass
  /// whose inputAccessoryView is nil - the standard way to drop that bar,
  /// since WKWebView exposes no setting for it.
  private static func hideFormAccessory(in webview: WKWebView) {
    guard
      let content = webview.scrollView.subviews.first(where: {
        String(describing: type(of: $0)).hasPrefix("WKContent")
      })
    else { return }
    let base: AnyClass = type(of: content)
    let name = "\(base)_TextusNoAccessory"
    var subclass: AnyClass? = NSClassFromString(name)
    if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
      let nothing: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
      class_addMethod(
        made, #selector(getter: UIResponder.inputAccessoryView),
        imp_implementationWithBlock(nothing), "@@:")
      objc_registerClassPair(made)
      subclass = made
    }
    if let subclass = subclass { object_setClass(content, subclass) }
  }

  /// The page's resting position: its top, less any inset the scroll view
  /// still adds.
  private func pinToTop() {
    guard let scroll = webview?.scrollView else { return }
    scroll.setContentOffset(
      CGPoint(x: 0, y: -scroll.adjustedContentInset.top), animated: false)
  }

  /// A turn with the keyboard up: the system keyboard window may stay drawn
  /// in the old orientation and report no new frame, leaving the page cut
  /// to a strip. The keyboard is put down instead, as a tap brings it back
  /// in the new orientation.
  private func turned() {
    guard let host = webview?.superview else { return }
    let landscape = host.bounds.width > host.bounds.height
    if let was = wasLandscape, was != landscape, toldCovered > 0 {
      host.window?.endEditing(true)
      keyboardEnd = nil
    }
    wasLandscape = landscape
    fit(animated: false)
  }

  private func keyboardMoved(_ note: Notification) {
    guard let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
    else { return }
    keyboardEnd = end
    let duration =
      note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    fit(animated: true, duration: duration)
  }

  /// The web view as tall as the host less what the keyboard covers of it
  /// (nothing when it is leaving, floating or split).
  private func fit(animated: Bool, duration: Double = 0) {
    guard let webview = webview, let host = webview.superview else { return }
    // A frame as wide as the screen was before a turn is the old
    // orientation's keyboard, which is no longer there.
    let screenWidth = host.window?.screen.bounds.width
    let current = keyboardEnd.flatMap { end -> CGRect? in
      guard let width = screenWidth, end.width > width + 1 else { return end }
      return nil
    }
    // Only a keyboard docked at the bottom, across the whole width, takes
    // height: an iPad's floating or split one sits over the page and moves.
    let docked = current.map { host.convert($0, from: nil) }.flatMap { end -> CGRect? in
      end.maxY >= host.bounds.maxY - 1 && end.width >= host.bounds.width - 1 ? end : nil
    }
    let covered = docked.map { max(0, host.bounds.maxY - $0.minY) } ?? 0
    // Shows for a moment below the shortened view as the keyboard moves.
    host.backgroundColor = .systemBackground
    var frame = host.bounds
    frame.size.height -= covered
    // The page reads the keyboard's state from this, not from its own
    // height, which a turn with the keyboard up leaves nothing to compare to.
    if covered != toldCovered {
      toldCovered = covered
      webview.evaluateJavaScript(
        "window.dispatchEvent(new CustomEvent('textus-keyboard', {detail: \(Double(covered))}))")
    }
    guard webview.frame != frame else { return }
    if !animated {
      webview.frame = frame
      pinToTop()
      return
    }
    UIView.animate(
      withDuration: duration,
      animations: {
        webview.frame = frame
        self.pinToTop()
      },
      completion: { [weak self] _ in self?.pinToTop() })
    pinToTop()
  }
}
