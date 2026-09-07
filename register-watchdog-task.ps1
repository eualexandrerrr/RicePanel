# Registra a tarefa "WidgetClaude-Watchdog": roda watchdog-widget.ps1 no logon e
# a cada 1 minuto, indefinidamente. Nao precisa de admin (contexto do usuario).

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'watchdog-widget.ps1'
$taskName = 'WidgetClaude-Watchdog'
$user = "$env:USERDOMAIN\$env:USERNAME"

# conhost --headless cria o console ja sem janela. Com a acao apontando direto para
# powershell.exe, o Task Scheduler (LogonType Interactive) desenha a janela ANTES do
# -WindowStyle Hidden ser processado: da um flash de console na tela a cada 1 minuto.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$action = New-ScheduledTaskAction -Execute $conhost -Argument (
  '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
)

# Logon + repeticao a cada 1 min sem prazo final.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT30S'
# Duration vazia = repetir indefinidamente ([TimeSpan]::MaxValue vira um XML
# invalido: "P99999999DT23H59M59S" fora do intervalo aceito pelo Task Scheduler).
$rep = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)).Repetition
$rep.Duration = ''
$trigger.Repetition = $rep

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Tarefa '$taskName' registrada: logon + a cada 1 minuto."
