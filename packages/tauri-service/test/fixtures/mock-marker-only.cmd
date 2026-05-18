@echo off
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%mock-marker-only.js" %*
