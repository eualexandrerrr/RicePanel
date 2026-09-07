# Apaga os monitores sem suspender o PC. O trabalho continua rodando; qualquer
# mexida no mouse ou tecla acorda a tela de novo.
#
# O atraso existe porque o clique que dispara isto ainda esta com a mao no mouse:
# sem ele o proprio movimento residual acende a tela de volta na hora.

param([int]$AtrasoMs = 1200)

$src = @'
using System;
using System.Runtime.InteropServices;

public static class Telas {
    private const int WM_SYSCOMMAND = 0x0112;
    private const int SC_MONITORPOWER = 0xF170;
    private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);

    // SendMessageTimeout, nao SendMessage: uma janela travada no desktop seguraria
    // o broadcast para sempre e o script nunca voltaria.
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam,
        IntPtr lParam, uint flags, uint ms, out IntPtr resultado);

    public static void Dorme() {
        IntPtr r;
        // lParam 2 = desligar. (1 = economia, 0 = ligar)
        SendMessageTimeout(HWND_BROADCAST, WM_SYSCOMMAND, (IntPtr)SC_MONITORPOWER,
            (IntPtr)2, 0x0002, 2000, out r);
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

Start-Sleep -Milliseconds ([Math]::Max(0, [Math]::Min(5000, $AtrasoMs)))
[Telas]::Dorme()
Write-Output 'ok'
