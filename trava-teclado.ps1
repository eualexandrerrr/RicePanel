# trava-teclado.ps1
# Engole TODA tecla enquanto roda, para limpar o teclado sem desligar o PC.
#
# Como solta:
#   1. o tempo (-Segundos) acaba;
#   2. o painel mata este processo (Windows tira o hook junto com o processo);
#   3. o processo pai (o widget) morre e o laco percebe.
#
# Nao precisa de admin. Duas coisas o hook NAO segura, de proposito do Windows:
# Ctrl+Alt+Del (sequencia segura) e janela rodando elevada em primeiro plano.
# Ou seja: sempre sobra sai da trava mesmo se tudo mais travar.

param(
  [int]$Segundos = 120,
  [int]$Pai = 0
)

$fonte = @'
using System;
using System.Runtime.InteropServices;

public static class TravaTeclado {
    private const int WH_KEYBOARD_LL = 13;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    // Campo estatico de proposito: delegate local o GC recolhe no meio do caminho
    // e o callback vira ponteiro morto (crash na primeira tecla).
    private static readonly HookProc _proc = Callback;
    private static IntPtr _hook = IntPtr.Zero;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
        public uint time; public int x; public int y;
    }

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);

    // Callback tem que ser rapido: acima de LowLevelHooksTimeout (300 ms) o
    // Windows arranca o hook sem avisar. Por isso ele nao faz nada alem de
    // devolver 1 (= tecla consumida, nao segue para ninguem).
    private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) return (IntPtr)1;
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static bool Liga() {
        if (_hook != IntPtr.Zero) return true;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        return _hook != IntPtr.Zero;
    }

    public static void Desliga() {
        if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
    }

    // Hook de baixo nivel so e chamado quando a thread olha a fila de mensagens.
    // Sem esta bomba rodando, o Windows considera a thread travada e derruba o hook.
    public static void Bombeia() {
        MSG m;
        while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { }
    }
}
'@

Add-Type -TypeDefinition $fonte -Language CSharp

if (-not [TravaTeclado]::Liga()) {
  Write-Output 'erro'
  exit 1
}

# O painel espera esta linha para saber que a trava pegou de verdade.
Write-Output 'ligado'

$fim = (Get-Date).AddSeconds([Math]::Max(5, [Math]::Min(600, $Segundos)))
$conta = 0
try {
  while ((Get-Date) -lt $fim) {
    [TravaTeclado]::Bombeia()
    Start-Sleep -Milliseconds 5
    $conta++
    # Get-Process e caro; checa o pai a cada ~1 s, nao a cada volta.
    if ($Pai -gt 0 -and ($conta % 200) -eq 0) {
      if (-not (Get-Process -Id $Pai -ErrorAction SilentlyContinue)) { break }
    }
  }
} finally {
  [TravaTeclado]::Desliga()
}

Write-Output 'solto'
