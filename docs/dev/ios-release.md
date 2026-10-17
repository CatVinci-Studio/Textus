# iOS release steps

`.github/workflows/ios-release.yml` builds and uploads the app. When you push an `ios-v*` tag, GitHub Actions builds a signed iOS app on macOS and uploads it to App Store Connect (TestFlight). You still submit for review by hand on the App Store Connect website.

## One-time setup

### 1. Register the App ID

[**Apple Developer › Identifiers**](https://developer.apple.com/account/resources/identifiers/list):

- The iOS app and the macOS app use the same bundle ID, `com.catvinci.textus` (`identifier` in `tauri.conf.json`). The 1.0.0 rename to Textus changed it from Levis's `com.chengaoshen.levis`. So you must register a new App ID here and create a matching app in App Store Connect (the old Levis record is no longer used). An App ID is not tied to one platform. The macOS app is signed with Developer ID and does not go through the App Store, so the ID may not be registered here yet. If it is not, register it. Because both apps share one ID, the macOS app can later be combined with the iOS app as one product (Universal Purchase) if it ships on the Mac App Store.
- You do not need to turn on any extra capabilities. Add iCloud later if you need an iCloud container.

### 2. Create the app in App Store Connect

[**App Store Connect › Apps**](https://appstoreconnect.apple.com/apps) **› + › New App**:

- Platform: iOS
- Name: Textus - Markdown Editor (the App Store already has an app named "TextUs"; enter the Chinese localized name separately)
- Primary language: English (add a Simplified Chinese localization)
- Bundle ID: `com.catvinci.textus` (see above)
- SKU: for example `textus-ios`
- After you create the app, go to **App › Pricing and Availability** and turn off availability on Mac computers with Apple silicon. The Mac already has a native macOS app, so the iPad app should not appear a second time in the Mac App Store.

### 3. Create an App Store Connect API key

**App Store Connect › Users and Access › Integrations › App Store Connect API**:

- The first time, there is only a **Request Access** button. The Account Holder must click it and accept the API terms before anyone can create keys.

Then go to **Team Keys › +**:

- Name: for example `Textus CI`. Access: **Admin**. CI signs with a cloud-managed distribution certificate from Apple, and only an Admin key can use it. If you choose App Manager, the signing step fails.
- Write down the **Issuer ID** and the **Key ID**, and download `AuthKey_<KeyID>.p8`. You can download this file only once, so keep it safe.

### 4. EU trader status

In **App Store Connect › Business**, enter the trader status that the EU Digital Services Act requires (an individual developer can also declare that they are not a trader). If you skip this, the new app cannot be published in the EU. Other regions are not affected.

### 5. Add the repository secrets

In **GitHub repository › Settings › Secrets and variables › Actions**, add:

| Name               | Value                           |
| ------------------ | ------------------------------- |
| `APPLE_API_ISSUER` | Issuer ID                       |
| `APPLE_API_KEY_ID` | Key ID                          |
| `APPLE_API_KEY_P8` | The full text of the `.p8` file |

`APPLE_TEAM_ID` already exists (the macOS release uses it). You do not need to add it again.

## Each release

1. Test on a Mac first:
   ```sh
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim
   npx tauri ios init        # first time only
   sh scripts/ios-prepare.sh # right after init: adds the privacy manifest (PrivacyInfo.xcprivacy)
   npx tauri ios dev         # simulator or device
   ```
2. Tag and upload. The version in the tag must match the version in `package.json` and the other version files (the workflow runs `scripts/check-versions.mjs` first and stops if they differ). For example, if the app is 1.0.4:
   ```sh
   git tag ios-v1.0.4 && git push origin ios-v1.0.4
   ```
   The workflow generates the build number (run number × 10 + attempt number), so rerunning a failed run never reuses the number of a build that was already uploaded. After about 20 minutes, the build appears in **App Store Connect › TestFlight** (Apple's processing takes another few minutes to half an hour).
3. In TestFlight, install the build on your own iPhone and iPad and try it. You can add internal testers first. They need no review.
4. In **App Store Connect › your app › iOS App › + Version**, choose this build, fill in the information below, and submit for review.

## Information the review needs

- **Screenshots** (required):
  - 6.9-inch iPhone: 1320 × 2868;
  - 13-inch iPad: 2064 × 2752 (only if the app supports iPad).

  You can take them in the simulator (iPhone 17 Pro Max, 13-inch iPad Pro).

- **Description, keywords, subtitle, promotional text:** You can adapt them from the "Features" section of the README.
- **Support URL:** `https://textus.catvinci.com`. **Privacy policy URL:** `https://textus.catvinci.com/privacy/`.
- **App Privacy** questionnaire: Textus does not collect data, so choose "Data Not Collected". AI requests go to a provider that the user sets up, straight from the device. They do not pass through our servers.
- **Age rating:** 4+.
- **Export compliance:** The app uses only standard encryption such as HTTPS. `src-tauri/Info.ios.plist` declares `ITSAppUsesNonExemptEncryption = false` (standard encryption such as HTTPS only), so App Store Connect does not ask again after upload.
- **Review notes:** Explain that the AI features need the user's own API key. Provide a test key, or explain how to use an option such as Ollama. Without a key, the editor itself is fully usable.

## Common rejection reasons

- **4.2 Minimum functionality / just a web wrapper:** Show the reviewer the native experience, such as Files app integration, opening files in place, the keyboard toolbar and the iPad layout.
- **2.1 Features that cannot be tested:** Give the reviewer a working way to test the AI features.
- **5.1.1 Privacy:** The questionnaire must match the app's actual behavior, and the privacy policy URL must open.
