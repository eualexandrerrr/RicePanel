# Manutencao do Windows disparada pelo widget Claude.
# Limpa caches (SEM tocar em Recentes/Quick Access do Explorer) e reinicia o driver de video.
# Auto-eleva (UAC). Grava progresso em maintenance.log e estado em maintenance.status.json.
# -Daily: modo tarefa agendada (logon) — sai sem fazer nada se ja rodou hoje.

param([switch]$Daily)

$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $dir 'maintenance.log'
$statusFile = Join-Path $dir 'maintenance.status.json'

# --- Auto-elevacao ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  $elevArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $MyInvocation.MyCommand.Path + '"'))
  if ($Daily) { $elevArgs += '-Daily' }
  Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList $elevArgs
  exit
}

# --- Modo diario: pula se ja executou hoje (manual ou agendado) ---
if ($Daily) {
  try {
    $st = Get-Content $statusFile -Raw | ConvertFrom-Json
    if ($st.finishedAt -and ([datetime]$st.finishedAt).Date -eq (Get-Date).Date) {
      $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
      Add-Content -Path $logFile -Value "[$ts] Daily: ja executado hoje, pulando."
      exit
    }
  } catch {}
}

$steps = New-Object System.Collections.ArrayList
function Log($msg) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $logFile -Value "[$ts] $msg"
}
function WriteStatus($running, $ok) {
  $obj = [ordered]@{
    running    = $running
    ok         = $ok
    steps      = $steps
    finishedAt = (Get-Date).ToString('o')
  }
  ($obj | ConvertTo-Json -Depth 4) | Set-Content -Path $statusFile -Encoding UTF8
}
function Step($name, [scriptblock]$action) {
  $freed = 0
  try { $freed = & $action } catch { Log "ERRO em ${name}: $_" }
  if ($null -eq $freed) { $freed = 0 }
  # Pasta que cresce durante a propria limpeza (Temp de app aberto) dava numero
  # negativo no relatorio: "liberado -11,9 MB" nao quer dizer nada para quem le.
  if ($freed -lt 0) { $freed = 0 }
  [void]$steps.Add([ordered]@{ name = $name; freedMB = [math]::Round($freed,1) })
  Log ("{0}: liberado {1} MB" -f $name, ([math]::Round($freed,1)))
  WriteStatus $true $true
}

function DirSizeBytes($path) {
  $sum = (Get-ChildItem -Path $path -Force -Recurse -ErrorAction SilentlyContinue |
    Where-Object { -not $_.PSIsContainer } |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return $sum
}

# Mede antes E depois da remocao: reporta apenas o que foi de fato liberado
# (arquivos travados/em uso ficam e nao contam).
function ClearDir($path, [string[]]$manter = @()) {
  if (-not (Test-Path $path)) { return 0 }
  $before = DirSizeBytes $path
  Get-ChildItem -Path $path -Force -ErrorAction SilentlyContinue |
    Where-Object { $manter -notcontains $_.Name } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  $after = DirSizeBytes $path
  return (($before - $after) / 1MB)
}

# O tipo e compilado AQUI, antes de qualquer limpeza, e nao dentro do passo la
# embaixo: o Add-Type do PowerShell 5.1 compila via csc.exe usando %TEMP%, e o
# passo 'Temp do usuario' ja esvaziou essa pasta. Compilando depois, a rodada de
# 30/08/2026 10:21 morreu calada no meio — processo saiu com codigo 0, sem log de
# erro e sem a linha de conclusao.
$src = @'
using System;
using System.Runtime.InteropServices;

public static class Standby {
    [DllImport("ntdll.dll")]
    private static extern uint NtSetSystemInformation(int infoClass, IntPtr info, int length);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr h, uint acesso, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool LookupPrivilegeValue(string sistema, string nome, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AdjustTokenPrivileges(IntPtr token, bool desativarTodos,
        ref TOKEN_PRIVILEGES novo, int tam, IntPtr anterior, IntPtr tamAnterior);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    // Pack = 1 nao e detalhe: com o alinhamento padrao o CLR enfia 4 bytes de
    // padding entre Count (int) e Luid (long), a struct vai com 20 bytes onde o
    // Windows espera 16, e o AdjustTokenPrivileges le lixo no lugar do Attrs.
    // Ele ainda devolve true, e a purga so falha depois, com PRIVILEGE_NOT_HELD.
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct TOKEN_PRIVILEGES { public int Count; public long Luid; public int Attrs; }

    // Purgar a standby list exige SeProfileSingleProcessPrivilege ligado no
    // token: ser admin so da o direito de ligar, nao liga sozinho.
    private static bool Habilita(string privilegio) {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x20 | 0x8, out token)) return false;
        long luid;
        if (!LookupPrivilegeValue(null, privilegio, out luid)) return false;
        TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
        tp.Count = 1; tp.Luid = luid; tp.Attrs = 0x2;   // SE_PRIVILEGE_ENABLED
        if (!AdjustTokenPrivileges(token, false, ref tp, Marshal.SizeOf(tp), IntPtr.Zero, IntPtr.Zero))
            return false;
        // ERROR_NOT_ALL_ASSIGNED: a chamada "deu certo" e o privilegio nao entrou.
        // Sem esta checagem o erro so aparece la na frente, disfarcado.
        return Marshal.GetLastWin32Error() == 0;
    }

    public static uint Purga() {
        if (!Habilita("SeProfileSingleProcessPrivilege")) return 0xFFFFFFFF;
        int comando = 4;   // MemoryPurgeStandbyList
        IntPtr buf = Marshal.AllocHGlobal(sizeof(int));
        try {
            Marshal.WriteInt32(buf, comando);
            return NtSetSystemInformation(0x50, buf, sizeof(int));   // SystemMemoryListInformation
        } finally { Marshal.FreeHGlobal(buf); }
    }
}
'@
if (-not ('Standby' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }

Log '=== Manutencao iniciada ==='
WriteStatus $true $true

# %TEMP%\claude guarda a sessao de trabalho do Claude Code (scratchpad, saida de
# tarefa em segundo plano). Limpar isso no meio de uma sessao apaga arquivo que
# esta em uso agora — aconteceu em 30/08/2026, no primeiro clique do botao novo.
Step 'Temp do usuario'      { ClearDir $env:TEMP @('claude') }
Step 'Temp do Windows'      { ClearDir (Join-Path $env:WINDIR 'Temp') }
Step 'Prefetch'             { ClearDir (Join-Path $env:WINDIR 'Prefetch') }
Step 'Cache miniaturas'     { ClearDir (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') }
Step 'Cache INetCache'      { ClearDir (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\INetCache') }
Step 'Relatorios de erro'   { ClearDir (Join-Path $env:LOCALAPPDATA 'CrashDumps') }
Step 'Delivery Optimization'{ ClearDir (Join-Path $env:WINDIR 'SoftwareDistribution\DeliveryOptimization\Cache') }

Step 'Windows Update cache' {
  $wu = Join-Path $env:WINDIR 'SoftwareDistribution\Download'
  Stop-Service wuauserv -Force -ErrorAction SilentlyContinue
  $f = ClearDir $wu
  Start-Service wuauserv -ErrorAction SilentlyContinue
  return $f
}

Step 'Flush DNS' { ipconfig /flushdns | Out-Null; return 0 }

# Standby list = memoria que o Windows ja leu do disco e guarda "por via das
# duvidas". Conta como disponivel, mas depois de build pesado ela fica cheia de
# lixo de arquivo que ninguem vai reler, e o proximo processo grande espera o
# Windows reciclar pagina por pagina. Purgar joga tudo na free list de uma vez.
Step 'Liberar RAM (standby)' {

  # "Available MBytes" ja conta a standby list, entao nao mede nada aqui. O que
  # muda de verdade e a free list. O contador de performance tem nome traduzido
  # em Windows pt-BR; a classe CIM crua nao tem.
  function FreeMB {
    $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -ErrorAction SilentlyContinue
    if (-not $m) { return 0 }
    return [double]$m.FreeAndZeroPageListBytes / 1MB
  }

  $antes = FreeMB
  $r = [Standby]::Purga()
  if ($r -ne 0) { Log "Standby: NtSetSystemInformation devolveu $r"; return 0 }
  Start-Sleep -Milliseconds 400
  $depois = FreeMB
  $ganho = $depois - $antes
  if ($ganho -lt 0) { $ganho = 0 }
  return $ganho
}

$totalMB = 0
foreach ($s in $steps) { $totalMB += [double]$s.freedMB }
Log ("=== Concluido. Total liberado: {0} MB ===" -f ([math]::Round($totalMB,1)))
WriteStatus $false $true
