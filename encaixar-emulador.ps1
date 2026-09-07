# Encaixa a janela do emulador do Android no retangulo que o painel reservou.
#
# Nao reparenta a janela (SetParent traria a janela para dentro do processo do
# Electron e qualquer erro levaria o emulador junto): so reposiciona. Se o
# Windows recusar, a janela continua flutuando e o painel segue funcionando.
param(
    [int]$X = 0,
    [int]$Y = 0,
    [int]$W = 0,
    [int]$H = 0,
    # Qual emulador: 0 = o primeiro que aparecer, 1 = o segundo.
    [int]$Indice = 0,
    # encaixar | minimizar | restaurar
    [string]$Acao = 'encaixar'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$origem = @"
using System;
using System.Runtime.InteropServices;
public class Encaixe {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Esquerda, Topo, Direita, Baixo; }
    [DllImport("user32.dll")] public static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@
Add-Type -TypeDefinition $origem

# A janela do aparelho e do qemu-system. O emulator.exe tambem abre janela (a de
# controles estendidos), e ela nao pode ser confundida com o aparelho — por isso
# o qemu vem sempre primeiro na lista.
$todas = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'qemu-system|emulator' -and $_.MainWindowHandle -ne 0 })
$janelas = @($todas | Where-Object { $_.ProcessName -match 'qemu-system' } | Sort-Object Id) +
           @($todas | Where-Object { $_.ProcessName -notmatch 'qemu-system' } | Sort-Object Id)

if ($janelas.Count -le $Indice) {
    Write-Output "sem janela de emulador no indice $Indice"
    exit 1
}

$h = $janelas[$Indice].MainWindowHandle

if ($Acao -eq 'minimizar') {
    # Minimiza em vez de esconder: janela escondida com ShowWindow(0) some da
    # barra de tarefas, e se o painel morrer nesse estado o emulador fica
    # inalcancavel. Minimizada, ele sempre volta pela barra.
    [void][Encaixe]::ShowWindow($h, 6)   # SW_MINIMIZE
    Write-Output "ok minimizado $h"
    exit 0
}

if ($Acao -eq 'restaurar') {
    [void][Encaixe]::ShowWindow($h, 9)   # SW_RESTORE
    Write-Output "ok restaurado $h"
    exit 0
}

# Minimizada, SetWindowPos move mas nao mostra: restaura antes de posicionar.
if ([Encaixe]::IsIconic($h)) { [void][Encaixe]::ShowWindow($h, 9) }   # SW_RESTORE

$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$ok = [Encaixe]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H, $SWP_NOZORDER -bor $SWP_NOACTIVATE)
if (-not $ok) { Write-Output "SetWindowPos recusou"; exit 1 }

# O emulador trava a proporcao do aparelho: pedir 467x1746 devolve 467x1017, e
# ele fica encostado no topo do vao. Tentar recentralizar depois foi pior — o
# segundo SetWindowPos mandou a janela para y=32767, fora de qualquer tela.
# Fica no topo do vao mesmo; o rasgo de chapa embaixo e honesto.
#
# Conferencia obrigatoria: se a janela terminar fora de toda area visivel, ela
# volta para o canto do vao. Janela invisivel nao tem como o Alexandre resgatar.
$r = New-Object Encaixe+RECT
if ([Encaixe]::GetWindowRect($h, [ref]$r)) {
    $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $foraDaTela = ($r.Esquerda -gt $virtual.Right) -or ($r.Topo -gt $virtual.Bottom) -or
                  ($r.Direita -lt $virtual.Left) -or ($r.Baixo -lt $virtual.Top)
    if ($foraDaTela) {
        [void][Encaixe]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0,
            0x0001 -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE)
        Write-Output "ok resgatado $h"
        exit 0
    }
}

# Devolve o tamanho que o emulador aceitou. Ele ignora a altura pedida e deriva
# a dele da largura; quem se ajusta na proxima vez e o painel, nao a janela.
$fim = New-Object Encaixe+RECT
[void][Encaixe]::GetWindowRect($h, [ref]$fim)
Write-Output "ok $($fim.Direita - $fim.Esquerda) $($fim.Baixo - $fim.Topo)"
