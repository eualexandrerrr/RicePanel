# Sobe o RicePanel no Windows, no monitor em pé (o LG).
#
# O node_modules deste repositório tem o Electron do Linux. Rodar `npm install`
# aqui trocaria o binário do outro sistema, então o Electron do Windows mora fora
# do repositório, em %LOCALAPPDATA%\RicePanel, e é baixado na primeira vez.
#
# Uso:
#   .\iniciar.ps1              Mirante (página de widgets)
#   .\iniciar.ps1 -Estacao     Estação (consoles, Dev, Monitor)
param([switch]$Estacao)
$ErrorActionPreference = 'Stop'

# Regex e não ConvertFrom-Json: o lock tem uma chave vazia (o pacote raiz) que o
# PowerShell 5.1 recusa.
$lock = Get-Content (Join-Path $PSScriptRoot 'package-lock.json') -Raw
$versao = [regex]::Match($lock, '"node_modules/electron":\s*\{\s*"version":\s*"([^"]+)"').Groups[1].Value
$pasta = Join-Path $env:LOCALAPPDATA "RicePanel\electron-v$versao"
$exe = Join-Path $pasta 'electron.exe'

if (-not (Test-Path $exe)) {
    $zip = Join-Path $env:LOCALAPPDATA 'RicePanel\electron.zip'
    New-Item -ItemType Directory -Force $pasta | Out-Null
    Write-Host "Baixando Electron $versao para Windows..."
    Invoke-WebRequest -UseBasicParsing -OutFile $zip `
        -Uri "https://github.com/electron/electron/releases/download/v$versao/electron-v$versao-win32-x64.zip"
    Expand-Archive -Path $zip -DestinationPath $pasta -Force
    Remove-Item $zip -Confirm:$false
}

# Fechar pelo X grava a sentinela; subir à mão é pedido explícito de voltar.
Remove-Item (Join-Path $PSScriptRoot 'mirante-stop.flag') -ErrorAction SilentlyContinue -Confirm:$false

$argumentos = @("`"$PSScriptRoot`"")
if ($Estacao) { $argumentos += '--estacao' }
Start-Process -FilePath $exe -ArgumentList $argumentos -WorkingDirectory $PSScriptRoot
