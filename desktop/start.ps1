# Launch the desktop companion.
#
# WHY THIS SCRIPT EXISTS
# DeepSeek Harness runs its own Electron binary with ELECTRON_RUN_AS_NODE=1 set,
# and child processes inherit that variable. Launched from a Harness terminal,
# this window's electron.exe would therefore start as plain Node: no `app`, no
# BrowserWindow, and the failure looks like a confusing "does not provide an
# export named 'BrowserWindow'" error rather than an environment problem.
#
# So the variable is cleared for this process only. It is harmless to clear when
# launching from an ordinary shell.
#
# Usage:
#   pwsh -File start.ps1
#   pwsh -File start.ps1 -SelfShot C:\temp\pet.png   # capture one frame and exit

[CmdletBinding()]
param(
    [string]$SelfShot
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$electron = Join-Path $here 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $electron)) {
    throw "Electron is not installed. Run 'npm install' in $here first."
}

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$arguments = @('.')
if ($SelfShot) {
    $arguments += "--self-shot=$SelfShot"
}

Write-Host 'starting the balance pet window (double-click the pet to close it)'
& $electron @arguments
