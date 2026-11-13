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
  /** The status bar's (or cutout's) height, in CSS px. */
  @Volatile private var top = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The page runs under the status bar and ends above the navigation bar
  // and the keyboard. Shortened so, the web view reports no safe area at
  // its top: the page reads it as TextusInsets.top() (mobile-viewport.ts).
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface fun top(): Float = top
      },
      "TextusInsets",
    )
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val density = view.resources.displayMetrics.density
      top = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout(),
      ).top / density
      val foot = insets.getInsets(
        WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.navigationBars(),
      ).bottom
      (view.parent as? View)?.setPadding(0, 0, 0, foot)
      ViewCompat.onApplyWindowInsets(view, insets)
    }
  }
}
