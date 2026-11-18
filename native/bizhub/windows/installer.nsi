Unicode true
!include "MUI2.nsh"
Name "Nexzek BizHub"
OutFile "..\..\..\artifacts\native\Nexzek-BizHub-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\NexzekBizHub"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nexzek.BizHub.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Store"
  SetOutPath "$INSTDIR"
  !include "install-files.nsh"
  SetOutPath "$INSTDIR"
  File "MicrosoftEdgeWebview2Setup.exe"
  ExecWait '"$INSTDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
  Delete "$INSTDIR\MicrosoftEdgeWebview2Setup.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Edgedirect2u"
  CreateShortcut "$SMPROGRAMS\Edgedirect2u\Store.lnk" "$INSTDIR\Nexzek.BizHub.exe"
  CreateShortcut "$DESKTOP\Nexzek BizHub.lnk" "$INSTDIR\Nexzek.BizHub.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexzekBizHub" "DisplayName" "Nexzek BizHub"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexzekBizHub" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexzekBizHub" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexzekBizHub" "Publisher" "Edgedirect2u"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\Nexzek BizHub.lnk"
  Delete "$SMPROGRAMS\Edgedirect2u\Store.lnk"
  RMDir "$SMPROGRAMS\Edgedirect2u"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexzekBizHub"
  !include "uninstall-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
