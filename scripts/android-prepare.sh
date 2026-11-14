#!/bin/sh
# Adds what the generated Android project (src-tauri/gen/android, made by
# `tauri android init` and not committed) does not get from tauri.conf.json.
# Run after `tauri android init`, before building.
#
# - The launcher icons from icons/android, over Tauri's placeholders.
# - MainActivity.kt from src-tauri/android: the page ends above the
#   navigation bar and the keyboard.
# - Release signing, when TEXTUS_ANDROID_KEYSTORE names a properties file
#   (keystore, alias, storePassword, keyPassword); the keystore path in it
#   is relative to that file.
set -eu
cd "$(dirname "$0")/../src-tauri"
app=gen/android/app
cp -R icons/android/. "$app/src/main/res/"
cp android/MainActivity.kt "$app/src/main/java/com/catvinci/textus/MainActivity.kt"
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
