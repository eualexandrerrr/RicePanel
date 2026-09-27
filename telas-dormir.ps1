# Apaga os monitores sem suspender o PC e deixa o Windows mudo. O trabalho
# continua rodando; qualquer mexida no mouse ou tecla acorda a tela de novo (o
# mudo fica: quem tira é ele).
#
# O atraso existe porque o clique que dispara isto ainda esta com a mao no mouse:
# sem ele o proprio movimento residual acende a tela de volta na hora.
#
# O apagar repete duas vezes (27/09/2026): programa que pede "tela ligada"
# (video tocando no Chrome, player da parede) acendia o monitor de novo segundos
# depois do primeiro SC_MONITORPOWER. O painel pausa o video antes de chamar
# isto; a repeticao cobre quem soltar o pedido com atraso.

param([int]$AtrasoMs = 1200, [switch]$SemMudo, [int]$GuardaS = 90, [string]$Log = '')

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

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO i);

    // Instante da ultima tecla ou mexida de mouse. SC_MONITORPOWER nao mexe
    // nisto; so gente mexe.
    public static uint UltimaEntrada() {
        var i = new LASTINPUTINFO();
        i.cbSize = (uint)Marshal.SizeOf(i);
        GetLastInputInfo(ref i);
        return i.dwTime;
    }

    public static void Dorme() {
        IntPtr r;
        // lParam 2 = desligar. (1 = economia, 0 = ligar)
        SendMessageTimeout(HWND_BROADCAST, WM_SYSCOMMAND, (IntPtr)SC_MONITORPOWER,
            (IntPtr)2, 0x0002, 2000, out r);
    }
}

// Mudo geral do Windows pelo Core Audio: o mesmo botao de mudo do icone de som,
// no dispositivo de saida padrao.
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float f, ref Guid g);
    int SetMasterVolumeLevelScalar(float f, ref Guid g);
    int GetMasterVolumeLevel(out float f);
    int GetMasterVolumeLevelScalar(out float f);
    int SetChannelVolumeLevel(uint n, float f, ref Guid g);
    int SetChannelVolumeLevelScalar(uint n, float f, ref Guid g);
    int GetChannelVolumeLevel(uint n, out float f);
    int GetChannelVolumeLevelScalar(uint n, out float f);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom { }

public static class Som {
    static IAudioEndpointVolume Saida() {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice dev;
        Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));   // render, multimedia
        var iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
        return (IAudioEndpointVolume)o;
    }
    public static bool Mudo() { bool m; Saida().GetMute(out m); return m; }
    public static void Muta() { var g = Guid.Empty; Saida().SetMute(true, ref g); }
    public static void Desmuta() { var g = Guid.Empty; Saida().SetMute(false, ref g); }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

function Anota([string]$t) {
    Write-Output $t
    if ($Log) { try { Add-Content -Path $Log -Value ((Get-Date).ToString('s') + ' ' + $t) -Encoding UTF8 } catch {} }
}

# O som volta quando ele volta (27/09/2026): mudo so enquanto a tela esta
# apagada. Se ja estava mudo antes, continua mudo — nao foi o painel que mutou.
$mutei = $false
if (-not $SemMudo) {
    try {
        if (-not [Som]::Mudo()) { [Som]::Muta(); $mutei = $true }
        Anota ('mudo=' + [Som]::Mudo() + ($(if ($mutei) { '' } else { ' (ja estava)' })))
    } catch { Anota ('mudo=falhou ' + $_.Exception.Message) }
}

Start-Sleep -Milliseconds ([Math]::Max(0, [Math]::Min(5000, $AtrasoMs)))

# Guarda (27/09/2026): um apagar so nao bastava, algum programa acendia a tela
# de novo segundos depois. Enquanto ninguem mexer no mouse nem no teclado, o
# script reapaga de 2 em 2 s por ate $GuardaS segundos. Mexeu: ele sai na hora
# e a tela fica acesa.
$entrada = [Telas]::UltimaEntrada()
[Telas]::Dorme()
Anota 'ok'
$fim = (Get-Date).AddSeconds([Math]::Max(0, $GuardaS))
while ((Get-Date) -lt $fim) {
    Start-Sleep -Milliseconds 2000
    if ([Telas]::UltimaEntrada() -ne $entrada) { break }
    [Telas]::Dorme()
}
# Passada a guarda, a tela fica por conta do Windows, mas o script segue
# esperando ele voltar (por ate 12 h) so para devolver o som.
$limite = (Get-Date).AddHours(12)
while ([Telas]::UltimaEntrada() -eq $entrada -and (Get-Date) -lt $limite) {
    Start-Sleep -Milliseconds 1000
}
Anota 'acordou por mouse/teclado'
if ($mutei) {
    try { [Som]::Desmuta(); Anota ('som de volta, mudo=' + [Som]::Mudo()) } catch { Anota ('desmutar falhou ' + $_.Exception.Message) }
}
