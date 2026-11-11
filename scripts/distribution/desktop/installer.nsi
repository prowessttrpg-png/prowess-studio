Unicode true
Name "Prowess Studio"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Prowess Studio"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Prowess Studio"
  SetShellVarContext current
FunctionEnd

Section "Prowess Studio"
  ReadRegStr $0 HKCU "Software\Prowess Studio" "CurrentVersion"
  StrCmp $0 "" install
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 install
  ExecWait '"$INSTDIR\versions\$0\ProwessStudio.exe" --quit' $1
  StrCmp $1 "0" install
  Abort "Close Prowess Studio before running Setup."
install:
  IfFileExists "$INSTDIR\versions\${VERSION}\ProwessStudio.exe" shortcuts
  CreateDirectory "$INSTDIR\versions"
  SetOutPath "$INSTDIR\versions\${VERSION}.pending"
  File /oname=ProwessStudio.exe "${LAUNCHER}"
  File /oname=Go-LICENSE.txt "${GO_LICENSE}"
  SetOutPath "$INSTDIR\versions\${VERSION}.pending\payload"
  File /r "${PAYLOAD}\*.*"
  SetOutPath "$INSTDIR"
  ClearErrors
  Rename "$INSTDIR\versions\${VERSION}.pending" "$INSTDIR\versions\${VERSION}"
  IfErrors 0 shortcuts
  Abort "Setup could not activate this version. The previous installation is available."
shortcuts:
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Prowess Studio.lnk" "$INSTDIR\versions\${VERSION}\ProwessStudio.exe"
  CreateDirectory "$SMPROGRAMS\Prowess Studio"
  CreateShortcut "$SMPROGRAMS\Prowess Studio\Prowess Studio.lnk" "$INSTDIR\versions\${VERSION}\ProwessStudio.exe"
  CreateShortcut "$SMPROGRAMS\Prowess Studio\Uninstall Prowess Studio.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Prowess Studio" "CurrentVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prowess Studio" "DisplayName" "Prowess Studio"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prowess Studio" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prowess Studio" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd

Function un.onInit
  StrCmp $INSTDIR "$LOCALAPPDATA\Prowess Studio" +2
  Abort "The installation path is invalid."
  SetShellVarContext current
FunctionEnd

Section "Uninstall"
  ReadRegStr $0 HKCU "Software\Prowess Studio" "CurrentVersion"
  StrCmp $0 "" remove
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 remove
  ExecWait '"$INSTDIR\versions\$0\ProwessStudio.exe" --quit' $1
  StrCmp $1 "0" remove
  Abort "Close Prowess Studio before uninstalling it."
remove:
  Delete "$DESKTOP\Prowess Studio.lnk"
  Delete "$SMPROGRAMS\Prowess Studio\Prowess Studio.lnk"
  Delete "$SMPROGRAMS\Prowess Studio\Uninstall Prowess Studio.lnk"
  RMDir "$SMPROGRAMS\Prowess Studio"
  RMDir /r "$INSTDIR\versions"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Prowess Studio"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prowess Studio"
SectionEnd
