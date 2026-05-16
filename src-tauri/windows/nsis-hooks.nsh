!macro NSIS_HOOK_POSTINSTALL
  ; The installer already runs with admin rights (perMachine mode).
  ; setup-office-addin.ps1 detects that it is already elevated and skips
  ; the UAC re-launch, so the entire Office add-in setup runs silently:
  ;   - CA certificate → LocalMachine\Root  (no Windows security dialog)
  ;   - WebView2 localhost loopback exemption
  ;   - Office trusted add-in catalog (local SMB share + registry)
  DetailPrint "Configuring OVC Office add-in (certificate, loopback, catalog)..."
  IfFileExists "$INSTDIR\resources\office-addin\setup-office-addin.ps1" 0 try_legacy
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\office-addin\setup-office-addin.ps1"'
    Goto setup_done
  try_legacy:
  IfFileExists "$INSTDIR\office-addin\setup-office-addin.ps1" 0 setup_not_found
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\office-addin\setup-office-addin.ps1"'
    Goto setup_done
  setup_not_found:
    DetailPrint "WARNING: setup-office-addin.ps1 was not found in the install directory."
  setup_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing OVC Office add-in configuration..."
  IfFileExists "$INSTDIR\resources\office-addin\uninstall-office-addin-cert.ps1" 0 try_legacy_uninstall
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\office-addin\uninstall-office-addin-cert.ps1"'
    Goto done_uninstall
  try_legacy_uninstall:
  IfFileExists "$INSTDIR\office-addin\uninstall-office-addin-cert.ps1" 0 +3
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\office-addin\uninstall-office-addin-cert.ps1"'
  done_uninstall:
  ; Clean up auto-start entry in case an older version of OVC added it.
  DeleteRegValue HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "OVC"
!macroend
