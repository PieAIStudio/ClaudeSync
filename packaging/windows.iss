#define AppVersion "1.3.0"
[Setup]
AppId={{A8AFB7E0-2B08-4E20-8B45-110011001100}
AppName=ClaudeSync
AppVersion={#AppVersion}
AppPublisher=PieAI
DefaultDirName={autopf}\ClaudeSync
DefaultGroupName=ClaudeSync
OutputDir=..\dist
OutputBaseFilename=ClaudeSync-windows-x64-setup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
UninstallDisplayName=ClaudeSync

[Files]
Source: "..\dist\ClaudeSync.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\ClaudeSyncCLI.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\ClaudeSync"; Filename: "{app}\ClaudeSync.exe"
Name: "{commondesktop}\ClaudeSync"; Filename: "{app}\ClaudeSync.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\ClaudeSync.exe"; Description: "Launch ClaudeSync"; Flags: nowait postinstall skipifsilent
