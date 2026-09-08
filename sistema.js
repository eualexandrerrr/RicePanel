// Leituras da máquina — Linux.
//
// Substitui o LibreHardwareMonitor (porta 8085) que o painel usava no Windows.
// Tudo aqui é leitura de /proc, /sys ou de um binário que já existe no Arch;
// nada depende de serviço extra rodando.
//
// O main faz um tique só e empurra o retrato inteiro para o renderer. Medida de
// uso (CPU, rede, disco) é sempre delta entre dois tiques: valor absoluto de
// contador cru não diz nada sozinho.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// --------------------------------------------------------------- utilitários

// Comando externo com prazo. Devolve string vazia em qualquer falha: o painel
// esconde a célula sem dado em vez de mostrar erro de leitura de sensor.
function roda(cmd, args, ms) {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = (s) => { if (!pronto) { pronto = true; resolve(s); } };
    let filho;
    try {
      filho = execFile(cmd, args, { timeout: ms || 2500, maxBuffer: 4 * 1024 * 1024 },
        (err, out) => fim(err && !out ? '' : String(out || '')));
    } catch (e) {
      return fim('');
    }
    filho.on('error', () => fim(''));
  });
}

function leArquivo(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

function num(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ----------------------------------------------------------------- CPU (uso)

// /proc/stat conta jiffies desde o boot. O que interessa é a fatia ocupada
// entre este tique e o anterior — por isso o estado fica guardado aqui.
let cpuAnterior = null;

function lerCpuUso() {
  const linhas = leArquivo('/proc/stat').split('\n');
  const total = [];
  for (const l of linhas) {
    if (!/^cpu\d* /.test(l)) continue;
    const campos = l.trim().split(/\s+/);
    const nome = campos[0];
    const v = campos.slice(1).map(Number);
    const ocioso = (v[3] || 0) + (v[4] || 0);           // idle + iowait
    const soma = v.reduce((a, b) => a + (b || 0), 0);
    total.push({ nome, ocioso, soma });
  }
  if (!total.length) return { pct: null, nucleos: [] };

  const antes = cpuAnterior;
  cpuAnterior = total;
  if (!antes) return { pct: null, nucleos: [] };

  const calcula = (agora, velho) => {
    if (!velho) return null;
    const dSoma = agora.soma - velho.soma;
    const dOcioso = agora.ocioso - velho.ocioso;
    if (dSoma <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((1 - dOcioso / dSoma) * 100)));
  };

  const porNome = Object.fromEntries(antes.map(c => [c.nome, c]));
  const geral = total.find(c => c.nome === 'cpu');
  return {
    pct: geral ? calcula(geral, porNome.cpu) : null,
    nucleos: total.filter(c => c.nome !== 'cpu').map(c => calcula(c, porNome[c.nome]))
  };
}

function lerCpuModelo() {
  const m = leArquivo('/proc/cpuinfo').match(/^model name\s*:\s*(.+)$/m);
  if (!m) return '';
  // "AMD Ryzen 7 5800X 8-Core Processor" — o sufixo comercial não cabe na chapa.
  return m[1].replace(/\((R|TM)\)/gi, '').replace(/\s+\d+-Core Processor/i, '')
    .replace(/CPU @.*/, '').trim();
}

// Frequência média em GHz. cpuinfo_cur_freq só existe em alguns governors, então
// /proc/cpuinfo (que sempre traz "cpu MHz") é o caminho que não falha.
function lerCpuFreq() {
  const mhz = [...leArquivo('/proc/cpuinfo').matchAll(/^cpu MHz\s*:\s*([\d.]+)$/gm)]
    .map(m => parseFloat(m[1])).filter(Number.isFinite);
  if (!mhz.length) return null;
  return Math.round(mhz.reduce((a, b) => a + b, 0) / mhz.length) / 1000;
}

// ------------------------------------------------------------- temperaturas

// Lê hwmon direto em vez de chamar `sensors`: é síncrono, custa microssegundos
// e não depende do lm_sensors estar instalado.
function lerTempHwmon() {
  const raiz = '/sys/class/hwmon';
  let melhores = { cpu: null, nvme: null };
  let nomes;
  try { nomes = fs.readdirSync(raiz); } catch (e) { return melhores; }

  for (const dir of nomes) {
    const base = path.join(raiz, dir);
    const nome = leArquivo(path.join(base, 'name')).trim();
    let arquivos;
    try { arquivos = fs.readdirSync(base); } catch (e) { continue; }

    for (const arq of arquivos) {
      const m = arq.match(/^temp(\d+)_input$/);
      if (!m) continue;
      const valor = num(leArquivo(path.join(base, arq)));
      if (valor == null) continue;
      const graus = Math.round(valor / 1000);
      if (graus <= 0 || graus > 130) continue;
      const rotulo = leArquivo(path.join(base, 'temp' + m[1] + '_label')).trim().toLowerCase();

      // k10temp/zenpower (AMD) e coretemp (Intel) são as fontes certas de CPU.
      // 'Tctl' vem com offset em alguns Ryzen; 'Tccd'/'Package' são os reais.
      if (/^(k10temp|zenpower|coretemp)$/.test(nome)) {
        const bom = /tccd|package|tdie/.test(rotulo) ? 2 : /tctl/.test(rotulo) ? 1 : 0;
        if (!melhores.cpu || bom > melhores.cpu.peso) melhores.cpu = { graus, peso: bom };
      }
      if (/nvme/.test(nome) && (!melhores.nvme || rotulo.includes('composite'))) {
        melhores.nvme = { graus, peso: 1 };
      }
    }
  }
  return {
    cpu: melhores.cpu ? melhores.cpu.graus : null,
    nvme: melhores.nvme ? melhores.nvme.graus : null
  };
}

// -------------------------------------------------------------------- GPU

// Uma chamada só devolve tudo da NVIDIA. Máquina sem placa NVIDIA cai no null e
// o painel esconde a célula inteira.
async function lerGpu() {
  const out = await roda('nvidia-smi', [
    '--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed',
    '--format=csv,noheader,nounits'
  ], 3000);
  const linha = out.split('\n')[0];
  if (!linha || !linha.trim()) return null;
  const p = linha.split(',').map(s => s.trim());
  return {
    nome: (p[0] || '').replace(/^NVIDIA\s+/i, '').replace(/GeForce\s+/i, ''),
    uso: num(p[1]),
    temp: num(p[2]),
    vramUsada: num(p[3]),
    vramTotal: num(p[4]),
    watts: num(p[5]),
    ventoinha: num(p[6])
  };
}

// --------------------------------------------------------------- memória

function lerMemoria() {
  const bruto = leArquivo('/proc/meminfo');
  const campo = (n) => {
    const m = bruto.match(new RegExp('^' + n + ':\\s+(\\d+) kB', 'm'));
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = campo('MemTotal');
  const disponivel = campo('MemAvailable');
  const swapTotal = campo('SwapTotal');
  const swapLivre = campo('SwapFree');
  if (!total || disponivel == null) return null;
  const usada = total - disponivel;
  return {
    total, usada,
    pct: Math.round((usada / total) * 100),
    swapTotal,
    swapUsado: swapTotal != null && swapLivre != null ? swapTotal - swapLivre : null
  };
}

// ----------------------------------------------------------------- discos

// statfs do próprio Node: sem `df`, sem parse de tabela, sem alias do shell
// (nesta máquina `df` é apelido de `duf`, que imprime outro formato).
function lerDiscos() {
  const pontos = ['/', os.homedir()];
  const vistos = new Set();
  const saida = [];
  for (const ponto of pontos) {
    try {
      const st = fs.statfsSync(ponto);
      const total = st.blocks * st.bsize;
      const livre = st.bavail * st.bsize;
      const chave = total + ':' + st.blocks;
      if (!total || vistos.has(chave)) continue;   // / e /home no mesmo volume: mostra uma vez
      vistos.add(chave);
      saida.push({
        ponto: ponto === os.homedir() ? '~' : ponto,
        total,
        usado: total - livre,
        pct: Math.round(((total - livre) / total) * 100)
      });
    } catch (e) {}
  }
  return saida;
}

// ------------------------------------------------------------------- rede

let redeAnterior = null;

function lerRede() {
  const linhas = leArquivo('/proc/net/dev').split('\n').slice(2);
  let rx = 0, tx = 0;
  const ativas = [];
  for (const l of linhas) {
    const m = l.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const iface = m[1].trim();
    if (iface === 'lo' || /^(docker|veth|br-|virbr)/.test(iface)) continue;
    const v = m[2].trim().split(/\s+/).map(Number);
    if (v[0] > 0 || v[8] > 0) ativas.push(iface);
    rx += v[0] || 0;
    tx += v[8] || 0;
  }
  const agora = { rx, tx, t: Date.now() };
  const antes = redeAnterior;
  redeAnterior = agora;
  if (!antes) return { rxs: null, txs: null, iface: ativas[0] || '' };
  const dt = (agora.t - antes.t) / 1000;
  if (dt <= 0) return { rxs: null, txs: null, iface: ativas[0] || '' };
  return {
    rxs: Math.max(0, (rx - antes.rx) / dt),
    txs: Math.max(0, (tx - antes.tx) / dt),
    iface: ativas[0] || ''
  };
}

// ------------------------------------------------------------------ o resto

function lerUptime() {
  const s = num(leArquivo('/proc/uptime').split(' ')[0]);
  return s == null ? null : Math.round(s);
}

function lerCarga() {
  return os.loadavg().map(n => Math.round(n * 100) / 100);
}

function lerDistro() {
  const m = leArquivo('/etc/os-release').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
  return m ? m[1] : 'Linux';
}

// ---------------------------------------------------- retrato completo

// Barato o bastante para rodar a cada 2 s: só GPU sai de processo externo.
async function retrato() {
  const [cpuUso, gpu] = [lerCpuUso(), await lerGpu()];
  const temps = lerTempHwmon();
  return {
    cpu: {
      pct: cpuUso.pct,
      nucleos: cpuUso.nucleos,
      modelo: lerCpuModelo(),
      fios: os.cpus().length,
      ghz: lerCpuFreq(),
      temp: temps.cpu
    },
    gpu,
    memoria: lerMemoria(),
    discos: lerDiscos(),
    rede: lerRede(),
    nvme: temps.nvme,
    uptime: lerUptime(),
    carga: lerCarga(),
    kernel: os.release(),
    distro: lerDistro(),
    host: os.hostname(),
    usuario: os.userInfo().username
  };
}

// ------------------------------------------------- coisas do desktop Arch

// Atualizações pendentes. `checkupdates` (pacman-contrib) usa uma cópia do banco
// em /tmp e NÃO mexe no pacman do sistema — pode rodar sem sudo e sem risco.
// Saída vazia com código 2 quer dizer "nada pendente", não erro.
async function pacotes() {
  const out = await roda('checkupdates', [], 20000);
  const linhas = out.split('\n').map(s => s.trim()).filter(Boolean);
  return {
    total: linhas.length,
    // Os cinco primeiros dão para reconhecer se é atualização grande.
    amostra: linhas.slice(0, 5).map(l => l.split(' ')[0])
  };
}

// Workspaces e janela em foco do Hyprland. Sem Hyprland devolve null e o painel
// esconde a faixa.
async function hyprland() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return null;
  const [wsBruto, ativoBruto, monBruto] = await Promise.all([
    roda('hyprctl', ['-j', 'workspaces'], 1500),
    roda('hyprctl', ['-j', 'activewindow'], 1500),
    roda('hyprctl', ['-j', 'monitors'], 1500)
  ]);
  try {
    const ws = JSON.parse(wsBruto || '[]');
    const ativo = JSON.parse(ativoBruto || '{}');
    const monitores = JSON.parse(monBruto || '[]');
    const focados = new Set(monitores.map(m => m.activeWorkspace && m.activeWorkspace.id));
    return {
      workspaces: ws
        .filter(w => w.id > 0)
        .sort((a, b) => a.id - b.id)
        .map(w => ({ id: w.id, janelas: w.windows, ativo: focados.has(w.id) })),
      janela: ativo && ativo.title ? { titulo: ativo.title, classe: ativo.class || '' } : null
    };
  } catch (e) {
    return null;
  }
}

// O que está tocando. playerctl devolve código != 0 quando não há player.
async function musica() {
  const out = await roda('playerctl', [
    'metadata', '--format',
    '{{status}}{{artist}}{{title}}{{mpris:length}}{{position}}{{playerName}}'
  ], 1500);
  const p = out.trim().split('');
  if (p.length < 3 || !p[2]) return null;
  const dur = num(p[3]);
  const pos = num(p[4]);
  return {
    tocando: /playing/i.test(p[0]),
    artista: p[1] || '',
    titulo: p[2] || '',
    // mpris devolve microssegundos.
    duracao: dur ? Math.round(dur / 1e6) : null,
    posicao: pos ? Math.round(pos / 1e6) : null,
    player: p[5] || ''
  };
}

module.exports = { retrato, pacotes, hyprland, musica, roda };
