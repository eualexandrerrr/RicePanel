# Registra tarefa agendada "WidgetClaude-Manutencao": roda maintenance.ps1 -Daily
# no logon do usuario, elevada (RunLevel Highest) e sem UAC. Precisa rodar como admin.

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'maintenance.ps1'
$taskName = 'WidgetClaude-Manutencao'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Daily'
)

# Dispara no logon, com 2 min de atraso para nao competir com o resto do startup.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT2M'

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Tarefa '$taskName' registrada: logon + 2 min, elevada, modo -Daily (1x/dia)."

# --- Tarefa sob demanda: o botao Cache do painel dispara esta, sem UAC ---
# Uma tarefa ja registrada com RunLevel Highest roda elevada sem perguntar nada.
# Sem ela o painel cai no Start-Process -Verb RunAs e o UAC aparece a cada clique.
# E tarefa separada porque a diaria roda com -Daily e sairia sem fazer nada se
# a manutencao ja tivesse rodado hoje — justamente o caso do clique manual.
$taskAgora = 'WidgetClaude-Manutencao-Agora'

$actionAgora = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"'
)

Register-ScheduledTask -TaskName $taskAgora -Action $actionAgora `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Tarefa '$taskAgora' registrada: sem gatilho, elevada, disparada pelo painel."
