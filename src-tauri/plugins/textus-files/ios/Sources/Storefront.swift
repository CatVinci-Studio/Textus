import Foundation
import StoreKit

// Whether this install came from the App Store in mainland China, where
// Textus AI isn't offered. Read synchronously by the app's boot script
// (src-tauri/src/settings/app.rs) before the first frame. The App Store
// account's storefront decides, not the device's language or region; the
// region only stands in when the storefront isn't known yet.
@_cdecl("textus_ai_unavailable")
public func textusAiUnavailable() -> Bool {
  if let code = SKPaymentQueue.default().storefront?.countryCode {
    return code == "CHN"
  }
  return Locale.current.region?.identifier == "CN"
}
