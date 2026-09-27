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

param([int]$AtrasoMs = 1200, [switch]$SemMudo)

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
}
'@

Add-Type -TypeDefinition $src -Language CSharp

if (-not $SemMudo) {
    try { [Som]::Muta(); Write-Output ('mudo=' + [Som]::Mudo()) } catch { Write-Output ('mudo=falhou ' + $_.Exception.Message) }
}

Start-Sleep -Milliseconds ([Math]::Max(0, [Math]::Min(5000, $AtrasoMs)))
[Telas]::Dorme()
Start-Sleep -Milliseconds 2500
[Telas]::Dorme()
Start-Sleep -Milliseconds 2500
[Telas]::Dorme()
Write-Output 'ok'
