$ErrorActionPreference = "Stop"
$base = (Resolve-Path "$PSScriptRoot\..").Path
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ClaudeSync --distpath "$base\dist" --workpath "$base\build\gui" "$base\claudesync.py"
python -m PyInstaller --noconfirm --clean --onefile --console --name ClaudeSyncCLI --distpath "$base\dist" --workpath "$base\build\cli" "$base\claudesync.py"
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (!(Test-Path $iscc)) { $iscc = "${env:ProgramFiles}\Inno Setup 6\ISCC.exe" }
& $iscc "$base\packaging\windows.iss"
