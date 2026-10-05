@echo off
rem ============================================================
rem  .githooks/pre-commit.cmd -- Windows pre-commit entry point
rem
rem  Keep this file PURE ASCII. cmd.exe reads batch files using the
rem  system ANSI codepage (GBK on Chinese Windows), so non-ASCII
rem  comments here get mangled and cmd.exe tries to run them as
rem  commands. That does not change ERRORLEVEL, so it fails quietly.
rem
rem  Why this wrapper is required:
rem  git resolves hooks in the order "exact name" then PATHEXT.
rem  .PS1 is NOT in the default PATHEXT, so a bare pre-commit.ps1
rem  is silently skipped by git and the gate never runs.
rem
rem  Real logic lives in pre-commit.ps1 next to this file.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pre-commit.ps1"
exit /b %ERRORLEVEL%
