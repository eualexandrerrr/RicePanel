# Garante que o widget esteja sempre no ar.
#
# Roda pela tarefa agendada "WidgetClaude-Watchdog" (a cada 1 minuto). Como quem
# cria o processo e o Task Scheduler, o electron nasce fora da arvore do terminal
# e sobrevive ao fechamento de qualquer shell (inclusive o Claude Code, que mata
# a arvore de processos ao sair).
#
# Respeita o fechamento manual: se o widget foi fechado pelo botao X ele grava
# widget-stop.flag e o watchdog nao reabre ate a flag sumir (restart-widget.ps1
# apaga a flag).
$ErrorActionPreference = 'SilentlyContinue'

$widgetDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron  = Join-Path $widgetDir 'node_modules\electron\dist\electron.exe'
$stopFlag  = Join-Path $widgetDir 'widget-stop.flag'
$logFile   = Join-Path $widgetDir 'watchdog.log'

function Log($msg) {
    try {
        if ((Get-Item $logFile -ErrorAction SilentlyContinue).Length -gt 128KB) {
            Move-Item $logFile "$logFile.old" -Force
        }
    } catch {}
    Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $msg)
}

if (Test-Path $stopFlag) { exit }
if (-not (Test-Path $electron)) { Log "electron ausente em $electron"; exit 1 }

$running = @(Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$widgetDir*" })
if ($running.Count -gt 0) { exit }

$cmd = '"{0}" "{1}"' -f $electron, $widgetDir
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $cmd
    CurrentDirectory = $widgetDir
}
if ($r.ReturnValue -eq 0) {
    Log "widget fora do ar - reiniciado (pid $($r.ProcessId))"
} else {
    Log "falha ao reiniciar: ReturnValue=$($r.ReturnValue)"
}
