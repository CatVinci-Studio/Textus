import Foundation
import StoreKit

// Whether Textus AI is offered nowhere on iOS: the first App Store release
// goes out without it. Set to true to offer it outside mainland China.
private let aiOutsideMainlandChina = false

// Whether this install goes without Textus AI: everywhere while the switch
// above is off, and always on an App Store download in mainland China, where
// it would need its own licence. Read synchronously by the app's boot script
// (src-tauri/src/settings/app.rs) before the first frame. The App Store
// account's storefront decides, not the device's language or region; the
// region only stands in when the storefront isn't known yet.
@_cdecl("textus_ai_unavailable")
public func textusAiUnavailable() -> Bool {
  if !aiOutsideMainlandChina { return true }
  if let code = SKPaymentQueue.default().storefront?.countryCode {
    return code == "CHN"
  }
  return Locale.current.region?.identifier == "CN"
}
