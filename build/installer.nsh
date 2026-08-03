!macro customCheckAppRunning
  !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
  !insertmacro nsProcess::FindProcess "AccuSim-DRSM-Telemetry-Router.exe" $R1

  ${If} $R0 == 0
  ${OrIf} $R1 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Eine laufende AccuSim-DRSM-Telemetry-Router-Instanz muss vor der Installation beendet werden.$\r$\n$\r$\nDie Bridge wird gestoppt. Installation fortsetzen?" \
      /SD IDOK IDOK closeRouterProcesses
    Quit

    closeRouterProcesses:
    DetailPrint "Laufende Router-Instanz wird beendet."
    !insertmacro nsProcess::CloseProcess "${APP_EXECUTABLE_FILENAME}" $R2
    !insertmacro nsProcess::CloseProcess "AccuSim-DRSM-Telemetry-Router.exe" $R3
    Sleep 1500

    !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      !insertmacro nsProcess::KillProcess "${APP_EXECUTABLE_FILENAME}" $R2
    ${EndIf}

    !insertmacro nsProcess::FindProcess "AccuSim-DRSM-Telemetry-Router.exe" $R1
    ${If} $R1 == 0
      !insertmacro nsProcess::KillProcess "AccuSim-DRSM-Telemetry-Router.exe" $R3
    ${EndIf}

    Sleep 500
  ${EndIf}

  !insertmacro nsProcess::Unload
!macroend
