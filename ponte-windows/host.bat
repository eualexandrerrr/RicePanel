@echo off
rem Host de native messaging da ponte do RicePanel no Windows.
rem O Chrome conversa com este processo pelo stdin/stdout: nada pode ser
rem impresso aqui alem do protocolo, por isso tudo vai para nul.
setlocal
set "HOST=%~dp0host.js"
where node >nul 2>nul
if not errorlevel 1 (
  node "%HOST%"
  exit /b
)
rem Sem node no PATH, o proprio Electron do painel roda o host como node.
for /d %%D in ("%LOCALAPPDATA%\RicePanel\electron-v*") do set "EL=%%D\electron.exe"
if not defined EL exit /b 1
set ELECTRON_RUN_AS_NODE=1
"%EL%" "%HOST%"
