package com.catvinci.textus

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.graphics.Rect
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

// Copied over the generated one by scripts/android-prepare.sh.
class MainActivity : TauriActivity() {
  /** The status bar's (or cutout's) and the navigation bar's heights, and
   *  what the cutout or a side navigation bar takes at either side (a phone
   *  on its side), in CSS px. */
  @Volatile private var top = 0f
  @Volatile private var bottom = 0f
  @Volatile private var left = 0f
  @Volatile private var right = 0f
  private var keyboard = -1f
  private var page: WebView? = null
  /** The page's own light or dark, which may differ from the system's; null
   *  when it follows the system. */
  private var pageDark: Boolean? = null
  /** The phone layout's sidebar opens with a swipe in from the left edge. */
  private var edgeSwipe = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Back closes what the page has open first (a menu, a sheet, the
    // sidebar); with nothing left it puts Textus in the background rather
    // than ending it, which tore its runtime down mid-use.
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val view = page ?: return run { moveTaskToBack(true) }
          view.evaluateJavascript("window.textusBack?.() === true") { closed ->
            if (closed != "true") moveTaskToBack(true)
          }
        }
      },
    )
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    barIcons()
    // The system's font size changed: the page picks its Interface Size
    // step again (`fontScale` below).
    page?.let { tell(it, "new Event('textus-font-scale')") }
  }

  /** Light icons on a dark page, dark on a light one. */
  private fun barIcons() {
    val dark = pageDark
      ?: ((resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
    // What shows beside the keyboard where the page doesn't reach (a
    // cutout's side): the app's own dark or light, as themes.xml has them.
    window.setBackgroundDrawable(ColorDrawable(if (dark) 0xFF121213.toInt() else 0xFFF7F6F3.toInt()))
  }

  // The page runs under the status bar and the navigation bar, its own
  // colours there, and ends at the keyboard, which the web view doesn't
  // make room for itself. It reports no safe area, so the page reads the
  // bars' sizes from TextusAndroid (android-bridge.ts), told when they change
  // (`textus-insets`), and the keyboard's height (`textus-keyboard`).
  override fun onWebViewCreate(webView: WebView) {
    page = webView
    // The page sizes its text by the system's font size itself, as a step
    // that grows icons and rows with it (theme/system-text-size.ts); the web
    // view's own zoom would grow the text a second time.
    webView.settings.textZoom = 100
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface fun top(): Float = top
        @JavascriptInterface fun bottom(): Float = bottom
        @JavascriptInterface fun left(): Float = left
        @JavascriptInterface fun right(): Float = right
        @JavascriptInterface fun fontScale(): Float = resources.configuration.fontScale
        @JavascriptInterface fun setEdgeSwipe(on: Boolean) {
          runOnUiThread {
            edgeSwipe = on
            keepEdge()
          }
        }
        /** The page's Appearance: "light", "dark" or "system". */
        @JavascriptInterface fun setAppearance(mode: String) {
          runOnUiThread {
            pageDark = when (mode) {
              "dark" -> true
              "light" -> false
              else -> null
            }
            barIcons()
          }
        }
      },
      "TextusAndroid",
    )
    webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> keepEdge() }
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val density = view.resources.displayMetrics.density
      val was = listOf(top, bottom, left, right)
      top = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout(),
      ).top / density
      bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density
      val sides = insets.getInsets(
        WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      left = sides.left / density
      right = sides.right / density
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      (view.parent as? View)?.setPadding(0, 0, 0, ime)
      if (was != listOf(top, bottom, left, right))
        tell(webView, "new Event('textus-insets')")
      if (ime / density != keyboard) {
        keyboard = ime / density
        tell(webView, "new CustomEvent('textus-keyboard', {detail: $keyboard})")
      }
      ViewCompat.onApplyWindowInsets(view, insets)
    }
  }

  /** A band of the left edge, mid-height, kept from the back gesture while
   *  the sidebar opens from there (Android grants up to 200dp of it). */
  private fun keepEdge() {
    val view = page ?: return
    val density = resources.displayMetrics.density
    val band = (200 * density).toInt()
    val mid = view.height / 2
    ViewCompat.setSystemGestureExclusionRects(
      view,
      if (edgeSwipe) listOf(Rect(0, mid - band / 2, (32 * density).toInt(), mid + band / 2))
      else emptyList(),
    )
  }

  private fun tell(webView: WebView, event: String) {
    webView.post { webView.evaluateJavascript("window.dispatchEvent($event)", null) }
  }
}
