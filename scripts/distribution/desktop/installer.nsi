Unicode true
!include WordFunc.nsh
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
  ReadRegStr $0 HKCU "Software\Prowess Studio" "CurrentPackage"
  ReadRegStr $2 HKCU "Software\Prowess Studio" "CurrentVersion"
  StrCmp $2 "" stop
  ${VersionCompare} "$2" "${VERSION}" $1
  StrCmp $1 "1" 0 stop
  Abort "This installer is older than your current Prowess Studio version."
stop:
  StrCmp $0 "" install
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 install
  ClearErrors
  ExecWait '"$INSTDIR\versions\$0\ProwessStudio.exe" --quit' $1
  IfErrors 0 +2
  Abort "Setup could not close the installed launcher."
  StrCmp $1 "0" install
  Abort "Close Prowess Studio before running Setup."
install:
  IfFileExists "$INSTDIR\versions\${PACKAGE_ID}\ProwessStudio.exe" shortcuts
  CreateDirectory "$INSTDIR\versions"
  RMDir /r "$INSTDIR\versions\${PACKAGE_ID}.pending"
  ClearErrors
  SetOutPath "$INSTDIR\versions\${PACKAGE_ID}.pending"
  File /oname=ProwessStudio.exe "${LAUNCHER}"
  File /oname=Go-LICENSE.txt "${GO_LICENSE}"
  File /oname=payload.zip "${PAYLOAD_ARCHIVE}"
  IfErrors failed
  ExecWait '"$INSTDIR\versions\${PACKAGE_ID}.pending\ProwessStudio.exe" --extract ${PAYLOAD_SHA256}' $1
  IfErrors failed
  StrCmp $1 "0" 0 failed
  Delete "$INSTDIR\versions\${PACKAGE_ID}.pending\payload.zip"
  SetOutPath "$INSTDIR"
  IfErrors failed
  Rename "$INSTDIR\versions\${PACKAGE_ID}.pending" "$INSTDIR\versions\${PACKAGE_ID}"
  IfErrors 0 shortcuts
failed:
  Abort "Setup could not activate this version. The previous installation is available."
shortcuts:
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Prowess Studio.lnk" "$INSTDIR\versions\${PACKAGE_ID}\ProwessStudio.exe"
  CreateDirectory "$SMPROGRAMS\Prowess Studio"
  CreateShortcut "$SMPROGRAMS\Prowess Studio\Prowess Studio.lnk" "$INSTDIR\versions\${PACKAGE_ID}\ProwessStudio.exe"
  CreateShortcut "$SMPROGRAMS\Prowess Studio\Uninstall Prowess Studio.lnk" "$INSTDIR\Uninstall.exe"
  StrCmp $0 "" register
  StrCmp $0 "${PACKAGE_ID}" register
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 register
  CreateShortcut "$SMPROGRAMS\Prowess Studio\Previous Prowess Studio.lnk" "$INSTDIR\versions\$0\ProwessStudio.exe"
register:
  WriteRegStr HKCU "Software\Prowess Studio" "CurrentPackage" "${PACKAGE_ID}"
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
  ReadRegStr $0 HKCU "Software\Prowess Studio" "CurrentPackage"
  StrCmp $0 "" remove
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 remove
  ClearErrors
  ExecWait '"$INSTDIR\versions\$0\ProwessStudio.exe" --quit' $1
  IfErrors 0 +2
  Abort "Uninstall could not close the installed launcher."
  StrCmp $1 "0" remove
  Abort "Close Prowess Studio before uninstalling it."
remove:
  IfFileExists "$INSTDIR\versions\$0\ProwessStudio.exe" 0 removeShortcuts
  ClearErrors
  ExecWait '"$INSTDIR\versions\$0\ProwessStudio.exe" --remove-payloads' $1
  IfErrors 0 +2
  Abort "The installed application files could not be removed."
  StrCmp $1 "0" removeShortcuts
  Abort "The installed application files could not be removed."
removeShortcuts:
  Delete "$DESKTOP\Prowess Studio.lnk"
  Delete "$SMPROGRAMS\Prowess Studio\Prowess Studio.lnk"
  Delete "$SMPROGRAMS\Prowess Studio\Previous Prowess Studio.lnk"
  Delete "$SMPROGRAMS\Prowess Studio\Uninstall Prowess Studio.lnk"
  RMDir "$SMPROGRAMS\Prowess Studio"
  RMDir /r "$INSTDIR\versions"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Prowess Studio"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prowess Studio"
SectionEnd
