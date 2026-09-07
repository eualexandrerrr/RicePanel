# Reinicia o widget DESANEXADO do terminal que chamou este script.
#
# Start-Process comum cria o electron como filho do shell atual; se esse shell
# roda dentro de um job object que mata a arvore ao sair (Claude Code, alguns
# terminais), o widget morre junto. Win32_Process.Create faz o WmiPrvSE criar o
# processo, entao ele nasce fora da arvore e sobrevive ao fechamento do terminal.
$ErrorActionPreference = 'Stop'

$widgetDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $widgetDir 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
    Write-Host "Electron nao encontrado - rode 'npm install' em $widgetDir"
    exit 1
}

# Encerra instancia anterior: a trava de instancia unica (requestSingleInstanceLock)
# faria a nova sair na hora, deixando a versao antiga do codigo na tela.
Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$widgetDir*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# Reabrir e uma decisao explicita: limpa a sentinela de fechamento manual para o
# watchdog voltar a vigiar o widget.
Remove-Item (Join-Path $widgetDir 'widget-stop.flag') -Force -ErrorAction SilentlyContinue

# Caminho preferido: a tarefa do watchdog. Ela roda DENTRO da sessao interativa
# do usuario, entao a janela nasce visivel no monitor vertical. O Win32_Process
# do WMI tambem sobe o processo, mas dependendo de quem chama (terminal elevado,
# sessao bloqueada) a janela nasce sem WS_VISIBLE: o painel fica vivo, com os
# bounds certos, e invisivel na tela. Medido em 28/08/2026.
$tarefa = Get-ScheduledTask -TaskName 'WidgetClaude-Watchdog' -ErrorAction SilentlyContinue
if ($tarefa) {
    Start-ScheduledTask -TaskName 'WidgetClaude-Watchdog'
    Start-Sleep -Seconds 6
    $p = Get-Process electron -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$widgetDir*" } |
        Sort-Object StartTime | Select-Object -First 1
    if ($p) {
        Write-Host "Widget reiniciado pela tarefa do watchdog (pid $($p.Id))"
        exit 0
    }
    Write-Host "Watchdog nao subiu o widget; caindo para o WMI"
}

$cmd = '"{0}" "{1}"' -f $electron, $widgetDir
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $cmd
    CurrentDirectory = $widgetDir
}
if ($r.ReturnValue -eq 0) {
    Write-Host "Widget reiniciado desanexado via WMI (pid $($r.ProcessId)) - confira se a janela apareceu"
} else {
    Write-Host "Falha ao iniciar: ReturnValue=$($r.ReturnValue)"
    exit 1
}
