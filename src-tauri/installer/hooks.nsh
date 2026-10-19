; Textus' installer hooks (`bundle > windows > nsis > installerHooks` in
; tauri.windows.conf.json): what keeps Textus under "Open with" for .md and
; .markdown, and in Settings > Apps > Default apps, whichever app holds the
; default. See docs/dev/windows-installer.md > File associations.
;
; The template's own association (from `bundle.fileAssociations`) only sets
; the extension's default value to Textus' ProgID. Another editor's installer
; replaces that value, and with it the only thing that named Textus for .md
; (#183). The values below are each Textus' own, so nothing else overwrites
; them.
;
; Per-user, like the install (`installMode` is `currentUser`). The same set
; is written by Settings > General > Default Markdown editor
; (src-tauri/src/commands/default_editor.rs) - change both.

!define TEXTUS_PROGID "Textus.Markdown"
!define TEXTUS_CAPABILITIES "Software\Textus\Capabilities"
!define TEXTUS_APPKEY "Software\Classes\Applications\${MAINBINARYNAME}.exe"

!macro TEXTUS_REGISTER_EXT EXT
  WriteRegNone HKCU "Software\Classes\${EXT}\OpenWithProgids" "${TEXTUS_PROGID}"
  WriteRegStr HKCU "${TEXTUS_APPKEY}\SupportedTypes" "${EXT}" ""
  WriteRegStr HKCU "${TEXTUS_CAPABILITIES}\FileAssociations" "${EXT}" "${TEXTUS_PROGID}"
!macroend

!macro TEXTUS_UNREGISTER_EXT EXT
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${TEXTUS_PROGID}"
  DeleteRegKey /ifempty HKCU "Software\Classes\${EXT}\OpenWithProgids"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The template writes the ProgID's command with the path unquoted, which
  ; breaks in a folder with a space in its name.
  WriteRegStr HKCU "Software\Classes\${TEXTUS_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  WriteRegStr HKCU "${TEXTUS_APPKEY}" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${TEXTUS_APPKEY}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "${TEXTUS_CAPABILITIES}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${TEXTUS_CAPABILITIES}" "ApplicationDescription" "Markdown editor"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "${TEXTUS_CAPABILITIES}"
  !insertmacro TEXTUS_REGISTER_EXT ".md"
  !insertmacro TEXTUS_REGISTER_EXT ".markdown"

  ; Explorer caches file types until the next sign-in otherwise.
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An uninstall run for an upgrade (/UPDATE) is followed by an install
  ; that would write all of this again.
  ${If} $UpdateMode <> 1
    !insertmacro TEXTUS_UNREGISTER_EXT ".md"
    !insertmacro TEXTUS_UNREGISTER_EXT ".markdown"
    DeleteRegKey HKCU "${TEXTUS_APPKEY}"
    DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"
    DeleteRegKey HKCU "${TEXTUS_CAPABILITIES}"
    DeleteRegKey /ifempty HKCU "Software\Textus"

    ; Up to 1.1.0-rc.6 Textus' ProgID was "Markdown", a name other editors
    ; share. Removed only while it still opens this copy of Textus.
    ReadRegStr $R0 HKCU "Software\Classes\Markdown\shell\open\command" ""
    ${If} $R0 == '$INSTDIR\${MAINBINARYNAME}.exe "%1"'
      DeleteRegKey HKCU "Software\Classes\Markdown"
    ${EndIf}

    !insertmacro UPDATEFILEASSOC
  ${EndIf}
!macroend
