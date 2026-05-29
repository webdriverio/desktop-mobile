# Setup script to register the testapp:// protocol handler for Tauri E2E testing on Windows
# Wrapper for shared setup script

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ScriptDir)))

$SharedScript = Join-Path $ProjectRoot "scripts\protocol-handlers\setup-protocol-handler.ps1"

& $SharedScript -AppDir $AppDir -ExecutableName "tauri-e2e-app.exe" -SearchPaths @("target\release","target\debug") -AppDisplayName "Tauri E2E Test App"
