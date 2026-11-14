#!/bin/sh
# Adds what the generated Android project (src-tauri/gen/android, made by
# `tauri android init` and not committed) does not get from tauri.conf.json.
# Run after `tauri android init`, before building.
#
# - The launcher icons from icons/android, over Tauri's placeholders.
# - MainActivity.kt from src-tauri/android: the page ends above the
#   navigation bar and the keyboard.
# - The activity left alone on a font, display size or navigation change
#   (a switch to gesture navigation swaps the system's overlays: assetsPaths):
#   the web view adapts, and a new page would drop the window's tabs.
# - The window's colour before the page draws, the launch splash's too: the
#   frame's, light and dark, not Material's default purple-white.
# - Release signing, when TEXTUS_ANDROID_KEYSTORE names a properties file
#   (keystore, alias, storePassword, keyPassword); the keystore path in it
#   is relative to that file.
set -eu
cd "$(dirname "$0")/../src-tauri"
app=gen/android/app
cp -R icons/android/. "$app/src/main/res/"
cp android/MainActivity.kt "$app/src/main/java/com/catvinci/textus/MainActivity.kt"
manifest="$app/src/main/AndroidManifest.xml"
grep -q 'fontScale' "$manifest" ||
  perl -pi -e 's/android:configChanges="([^"]*)"/android:configChanges="$1|fontScale|density|navigation"/' "$manifest"
grep -q 'assetsPaths' "$manifest" ||
  perl -pi -e 's/android:configChanges="([^"]*)"/android:configChanges="$1|assetsPaths"/' "$manifest"
for night in "" "-night"; do
  colour=$([ -z "$night" ] && echo '#F7F6F3' || echo '#121213')
  theme="$app/src/main/res/values$night/themes.xml"
  grep -q 'windowBackground' "$theme" ||
    perl -pi -e "s|<!-- Customize your theme here. -->|<item name=\"android:windowBackground\">$colour</item>|" "$theme"
  grep -q 'windowSplashScreenBackground' "$theme" ||
    perl -pi -e "s|(<item name=\"android:windowBackground\">[^<]*</item>)|\$1<item name=\"android:windowSplashScreenBackground\" tools:targetApi=\"31\">$colour</item>|" "$theme"
done
gradle="$app/build.gradle.kts"
if [ -n "${TEXTUS_ANDROID_KEYSTORE:-}" ] && ! grep -q 'signingConfigs' "$gradle"; then
  cat >> "$gradle" <<GRADLE

val textusKeystore = Properties().apply {
    file("$TEXTUS_ANDROID_KEYSTORE").inputStream().use { load(it) }
}
android {
    signingConfigs {
        create("release") {
            storeFile = file("$TEXTUS_ANDROID_KEYSTORE").parentFile.resolve(textusKeystore.getProperty("keystore"))
            storePassword = textusKeystore.getProperty("storePassword")
            keyAlias = textusKeystore.getProperty("alias")
            keyPassword = textusKeystore.getProperty("keyPassword")
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
GRADLE
fi
