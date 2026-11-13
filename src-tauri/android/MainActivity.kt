package com.catvinci.textus

import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// Copied over the generated one by scripts/android-prepare.sh.
class MainActivity : TauriActivity() {
  /** The status bar's (or cutout's) and the navigation bar's heights, in
   *  CSS px. */
  @Volatile private var top = 0f
  @Volatile private var bottom = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The page runs under the status bar and the navigation bar, its own
  // colours there, and ends at the keyboard, which the web view doesn't
  // make room for itself. It reports no safe area, so the page reads the
  // bars' heights as TextusInsets (mobile-viewport.ts).
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface fun top(): Float = top
        @JavascriptInterface fun bottom(): Float = bottom
      },
      "TextusInsets",
    )
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val density = view.resources.displayMetrics.density
      top = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout(),
      ).top / density
      bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      (view.parent as? View)?.setPadding(0, 0, 0, keyboard)
      ViewCompat.onApplyWindowInsets(view, insets)
    }
  }
}
