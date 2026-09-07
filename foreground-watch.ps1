# Controla a z-order do widget e emite o estado no stdout (consumido pelo main.js
# apenas para log/sincronia da flag do Electron).
#
# Processo unico e persistente: evita spawnar um powershell por amostragem.
#
# Criterio: NAO e o app em foreground que decide, e sim quem esta efetivamente
# cobrindo o retangulo do widget. Varre a z-order de cima para baixo e coleta
# TODAS as janelas visiveis que intersectam o widget. Prioridade da decisao:
#   1. algum emulador cobrindo -> widget vai ABAIXO do mais baixo deles (fica
#      atras de todos, ex.: dois emuladores Android abertos ao mesmo tempo).
#      Regra absoluta: emulador nunca pode ficar coberto pelo widget.
#   2. senao, algum navegador cobrindo -> TOPMOST. Regra absoluta oposta: o
#      navegador nunca pode cobrir o widget, mesmo que outro app tambem cubra
#      a area (era esse o caso que falhava: com o overlay do Lightshot na lista,
#      o widget descia e o Firefox ficava por cima dele).
#   3. senao, outro app cobrindo -> widget abaixo do mais baixo deles.
#   4. ninguem -> nada a decidir, mantem o estado atual.
# Janelas em -Ignore nao contam para nada (overlays que cobrem a tela inteira
# sem serem app de verdade).
# Decidir pelo foreground falhava no caso de dois monitores: com o foco no code,
# o widget descia, mas o chrome que cobria a area dele no outro monitor continuava
# por cima.
#
# Por que "abaixo da janela que cobre" e nao HWND_BOTTOM nem NOTOPMOST:
#   - HWND_BOTTOM manda para o fundo absoluto, que fica ATRAS do Progman (a janela
#     do desktop, que cobre todos os monitores): o widget some de vez.
#   - NOTOPMOST insere ACIMA de todas as nao-topmost, ou seja, acima justamente do
#     app que estava cobrindo o widget.
# Inserir depois de uma janela nao-topmost tambem remove o TOPMOST do widget (doc
# do SetWindowPos), entao uma chamada resolve os dois lados.
param(
    [Parameter(Mandatory = $true)][string]$Hwnd,      # handle da janela do widget (decimal)
    [Parameter(Mandatory = $true)][string]$Browsers,  # nomes de processo separados por virgula
    [string]$Emulators = '',                          # idem: o widget sempre fica atras destes
    [string]$Ignore = ''                              # idem: janelas que nao contam
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);

  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  const int DWMWA_CLOAKED = 14;   // janelas UWP suspensas continuam "visiveis" para o user32
  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOPMOST = 0x8;

  static StringBuilder acc;
  static IntPtr skipWindow;
  static uint skipPid;
  static int rl, rt, rr, rb;

  // Todas as janelas visiveis que intersectam o retangulo dado, em ordem de
  // z-order (mais alta primeiro), como "hwnd|topmost|processo;..."; vazio se
  // nenhuma cobre a area. Enumerar todas (e nao so a mais alta) permite ao
  // chamador pôr o widget abaixo de TODAS as janelas nao-navegador (ex.: dois
  // emuladores Android cobrindo a mesma area).
  public static string Overlappers(IntPtr widget, int l, int t, int r, int b) {
    acc = new StringBuilder();
    skipWindow = widget; rl = l; rt = t; rr = r; rb = b;
    GetWindowThreadProcessId(widget, out skipPid);
    EnumWindows(new EnumProc(Visit), IntPtr.Zero);   // EnumWindows entrega em ordem de z-order
    return acc.ToString();
  }

  static bool Visit(IntPtr h, IntPtr lp) {
    if (h == skipWindow) return true;
    if (!IsWindowVisible(h) || IsIconic(h)) return true;

    int cloaked = 0;
    if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;

    RECT w;
    if (!GetWindowRect(h, out w)) return true;
    if (w.R <= w.L || w.B <= w.T) return true;
    if (w.R <= rl || w.L >= rr || w.B <= rt || w.T >= rb) return true;   // nao intersecta

    StringBuilder cn = new StringBuilder(256);
    GetClassName(h, cn, cn.Capacity);
    string c = cn.ToString();
    // Desktop, barra de tarefas e afins cobrem a tela inteira e nao contam.
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd"
        || c == "SysShadow" || c == "Button") return true;

    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid == skipPid) return true;   // outras janelas do proprio widget

    string name;
    try { name = Process.GetProcessById((int)pid).ProcessName.ToLower(); }
    catch { name = ""; }
    bool tm = (GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
    if (acc.Length > 0) acc.Append(';');
    acc.Append(h.ToInt64()).Append('|').Append(tm ? '1' : '0').Append('|').Append(name);
    return true;   // continua: coleta todas as janelas que cobrem
  }
}
"@

$widget = [IntPtr][int64]$Hwnd
function Split-Names([string]$s) {
    @($s.Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
}
$browserList  = Split-Names $Browsers
$emulatorList = Split-Names $Emulators
$ignoreList   = Split-Names $Ignore

# Verdadeiro se o nome do processo contem algum dos padroes da lista.
function Test-Name([string]$name, [string[]]$patterns) {
    foreach ($p in $patterns) { if ($name -like "*$p*") { return $true } }
    return $false
}

$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP = 0x0001 -bor 0x0002 -bor 0x0010   # NOSIZE | NOMOVE | NOACTIVATE

# Poe o widget atras da MAIS BAIXA janela do grupo: assim ele fica atras de
# todas elas, nao so da mais alta.
function Set-Below($grupo) {
    $target = $grupo[-1]
    if ($target.Topmost) {
        # A mais baixa ja e topmost: basta o widget deixar de ser topmost para
        # ficar abaixo de todas.
        [void][FG]::SetWindowPos($widget, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP)
    } else {
        [void][FG]::SetWindowPos($widget, $target.H, 0, 0, 0, 0, $SWP)
    }
}

$lastState = ''
$lastName = ''

while ($true) {
    if (-not [FG]::IsWindow($widget)) { break }   # widget fechou: encerra o watcher

    # Widget em foco (usuario clicando/arrastando): nao mexe na z-order.
    if ([FG]::GetForegroundWindow() -ne $widget) {
        $rect = New-Object FG+RECT
        if ([FG]::GetWindowRect($widget, [ref]$rect)) {
            $raw = [FG]::Overlappers($widget, $rect.L, $rect.T, $rect.R, $rect.B)

            if ($raw) {
                # Parseia "hwnd|topmost|processo;..." mantendo a ordem (mais alta primeiro).
                $items = foreach ($e in $raw.Split(';')) {
                    $p = $e.Split('|', 3)
                    [pscustomobject]@{
                        H       = [IntPtr][int64]$p[0]
                        Topmost = ($p[1] -eq '1')
                        Name    = $p[2]
                    }
                }

                # Overlays que nao contam saem antes de qualquer decisao.
                $items = @($items | Where-Object { -not (Test-Name $_.Name $ignoreList) })

                # Nomes de variavel nao podem repetir os dos parametros ($Browsers,
                # $Emulators): a restricao [string] do parametro converteria o array
                # para texto em silencio.
                $emus   = @($items | Where-Object { Test-Name $_.Name $emulatorList })
                $navs   = @($items | Where-Object { Test-Name $_.Name $browserList })
                $outros = @($items | Where-Object {
                    -not (Test-Name $_.Name $emulatorList) -and -not (Test-Name $_.Name $browserList)
                })

                # Reaplica todo tick: se o Electron ou o proprio Windows reordenar a
                # janela, ela volta para o lugar certo em <= 400 ms.
                $state = ''
                if ($emus.Count -gt 0) {
                    Set-Below $emus
                    $state = 'BELOW'
                    $name = (@($emus | ForEach-Object { $_.Name } | Select-Object -Unique) -join ',')
                } elseif ($navs.Count -gt 0) {
                    # Navegador cobrindo manda o widget para a frente, mesmo que
                    # outro app tambem cubra a area.
                    [void][FG]::SetWindowPos($widget, $HWND_TOPMOST, 0, 0, 0, 0, $SWP)
                    $state = 'TOP'
                    $name = $navs[0].Name
                } elseif ($outros.Count -gt 0) {
                    Set-Below $outros
                    $state = 'BELOW'
                    $name = (@($outros | ForEach-Object { $_.Name } | Select-Object -Unique) -join ',')
                }

                if ($state -and ($state -ne $lastState -or $name -ne $lastName)) {
                    $lastState = $state
                    $lastName = $name
                    [Console]::Out.WriteLine("$state $name"); [Console]::Out.Flush()
                }
            }
        }
    }

    Start-Sleep -Milliseconds 400
}
