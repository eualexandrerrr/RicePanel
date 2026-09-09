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

// Modelo do NVMe. O anel da térmica diz o nome da peça — CPU, placa de vídeo —
// e o disco não tinha por que ser o único a aparecer como categoria.
function lerNvmeModelo() {
  const raiz = '/sys/class/nvme';
  let nomes;
  try { nomes = fs.readdirSync(raiz); } catch (e) { return ''; }
  for (const dir of nomes.sort()) {
    const m = leArquivo(path.join(raiz, dir, 'model')).trim();
    // "Corsair MP700 ELITE" não cabe no rótulo do anel; a linha do modelo cabe.
    if (m) return m.replace(/^(Corsair|Samsung|Kingston|WDC?|Western Digital|Seagate|Crucial|ADATA|Sabrent|Intel|Micron|SK ?hynix)\s+/i, '');
  }
  return '';
}

// -------------------------------------------------------------------- GPU

// A máquina tem mais de uma placa: NVIDIA pelo nvidia-smi, AMD por /sys. Cada
// fonte devolve uma lista, e o painel desenha um anel por placa encontrada.
// Sem placa nenhuma as duas listas voltam vazias e a faixa some.

// Nome comercial pelo lspci. O barramento PCI não muda enquanto a máquina está
// ligada, então basta uma chamada por slot na vida do processo.
const nomesPci = new Map();

async function nomePci(slot) {
  if (nomesPci.has(slot)) return nomesPci.get(slot);
  nomesPci.set(slot, '');                       // evita duas chamadas em paralelo
  const out = await roda('lspci', ['-mm', '-s', slot], 2000);
  // 04:00.0 "VGA..." "Advanced Micro Devices, Inc. [AMD/ATI]" "Lexa PRO [Radeon 550]" ...
  const campos = [...out.matchAll(/"([^"]*)"/g)].map(m => m[1]);
  const nome = limpaNomeGpu(campos[2] || '');
  nomesPci.set(slot, nome);
  return nome;
}

// O PCI ID da AMD não identifica o modelo, e sim a família inteira: a mesma
// entrada "Lexa PRO" serve 540, 540X, 550 e 550X. Como o barramento não sabe
// qual das quatro está no slot, quem sabe é o dono da máquina — daqui sai o
// nome que ele confirmou.
const APELIDOS_GPU = [
  { quando: /lexa/i, nome: 'Radeon RX 550' }
];

// Tira o que não ajuda a reconhecer a placa de relance: marca repetida, sufixo
// de marca registrada e a lista de modelos irmãos que a AMD publica no PCI ID
// ("Lexa PRO [Radeon 540/540X/550/550X / RX 540X/550/550X]").
function limpaNomeGpu(bruto) {
  for (const a of APELIDOS_GPU) {
    if (a.quando.test(String(bruto || ''))) return a.nome;
  }
  // A marca fica: "NVIDIA RTX 3090" é como ele chama a placa, e sem ela a linha
  // ficava só com o modelo enquanto a AMD ao lado dizia "Radeon". Some só o
  // "GeForce", que não distingue nada aqui.
  let n = String(bruto || '')
    .replace(/\((R|TM)\)/gi, '')
    .replace(/GeForce\s+/i, '')
    .replace(/Advanced Micro Devices[^\[]*/i, '')
    .trim();
  const colchete = n.match(/\[([^\]]+)\]/);
  if (colchete) {
    // Fica só a primeira alternativa da lista: "Radeon 540/550" vira "Radeon 540".
    n = colchete[1].split(' / ')[0].split('/')[0].trim();
  }
  return n;
}

// A mesma consulta serve para o `nvidia-smi` do host e para o que roda dentro
// da VM, então a leitura do CSV mora aqui e os dois chamadores só põem a chave.
const CONSULTA_NVIDIA = [
  '--query-gpu=index,name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed',
  '--format=csv,noheader,nounits'
];

function analisaNvidiaSmi(out) {
  const saida = [];
  for (const linha of String(out || '').split('\n')) {
    if (!linha.trim()) continue;
    const p = linha.split(',').map(s => s.trim());
    // Sem driver carregado o `nvidia-smi` escreve a reclamação na SAÍDA PADRÃO
    // e sai com código 9 — a linha de erro chegava aqui e virava uma placa de
    // vídeo sem nome, com um anel vazio no painel. Linha boa começa com o
    // índice e traz os oito campos pedidos.
    if (p.length < 8 || !/^\d+$/.test(p[0])) continue;
    saida.push({
      indice: p[0],
      nome: limpaNomeGpu(p[1]),
      uso: num(p[2]),
      temp: num(p[3]),
      vramUsada: num(p[4]),          // MiB, como o nvidia-smi entrega
      vramTotal: num(p[5]),
      watts: num(p[6]),
      ventoinha: num(p[7])
    });
  }
  return saida;
}

async function lerGpusNvidia() {
  const lidas = analisaNvidiaSmi(await roda('nvidia-smi', CONSULTA_NVIDIA, 3000));
  return lidas.map((g, i) => Object.assign({ chave: 'nvidia' + (g.indice || i), marca: 'NVIDIA' }, g));
}

// AMD não tem um `nvidia-smi`: tudo sai de /sys/class/hwmon e da pasta do
// dispositivo PCI logo acima dele. É leitura de arquivo, custa microssegundos.
async function lerGpusAmd() {
  const raiz = '/sys/class/hwmon';
  let nomes;
  try { nomes = fs.readdirSync(raiz); } catch (e) { return []; }

  const achadas = [];
  for (const dir of nomes.sort()) {
    const base = path.join(raiz, dir);
    if (leArquivo(path.join(base, 'name')).trim() !== 'amdgpu') continue;

    let dev = '';
    let slot = '';
    try {
      dev = fs.realpathSync(path.join(base, 'device'));
      slot = path.basename(dev).replace(/^0000:/, '');
    } catch (e) { continue; }

    // 'edge' é a borda do die — a medida equivalente à que o nvidia-smi dá.
    // 'junction' é o ponto quente e leria sempre mais alto que a NVIDIA ao lado.
    let temp = null, pesoTemp = -1;
    let arquivos;
    try { arquivos = fs.readdirSync(base); } catch (e) { arquivos = []; }
    for (const arq of arquivos) {
      const m = arq.match(/^temp(\d+)_input$/);
      if (!m) continue;
      const v = num(leArquivo(path.join(base, arq)));
      if (v == null) continue;
      const graus = Math.round(v / 1000);
      if (graus <= 0 || graus > 130) continue;
      const rotulo = leArquivo(path.join(base, 'temp' + m[1] + '_label')).trim().toLowerCase();
      const peso = /edge/.test(rotulo) ? 2 : /junction|mem/.test(rotulo) ? 0 : 1;
      if (peso > pesoTemp) { temp = graus; pesoTemp = peso; }
    }

    const vramUsada = num(leArquivo(path.join(dev, 'mem_info_vram_used')));
    const vramTotal = num(leArquivo(path.join(dev, 'mem_info_vram_total')));
    const microwatts = num(leArquivo(path.join(base, 'power1_input')));
    const pwm = num(leArquivo(path.join(base, 'pwm1')));

    achadas.push({
      chave: 'amd' + slot,
      marca: 'AMD',
      nome: await nomePci(slot) || 'Radeon',
      uso: num(leArquivo(path.join(dev, 'gpu_busy_percent'))),
      temp,
      vramUsada: vramUsada == null ? null : Math.round(vramUsada / 1048576),
      vramTotal: vramTotal == null ? null : Math.round(vramTotal / 1048576),
      watts: microwatts == null ? null : Math.round(microwatts / 1e6 * 10) / 10,
      ventoinha: pwm == null ? null : Math.round((pwm / 255) * 100)
    });
  }
  return achadas;
}

// ------------------------------------------------- GPU presa no vfio (a VM)

// Desde que o passthrough entrou, a 3090 não pertence mais ao host: o vfio a
// prende antes do driver da NVIDIA, então não existe `nvidia-smi` aqui e o
// /sys não publica sensor nenhum dela. Quem enxerga a placa é o Windows de
// dentro da VM, e o caminho até ele é o qemu-guest-agent.
//
// A placa aparece no painel dos dois jeitos: com a VM ligada, com os números
// que o Windows lê; com a VM desligada, só o nome e o aviso de que ela está
// reservada. Sumir da faixa seria pior — ela continua no gabinete.

const VM_DOMINIO = 'w11';
const VM_INTERVALO = 5000;

let vmCache = { quando: 0, linhas: [], buscando: false };

// Placas de vídeo que estão no vfio-pci. Classe 0x0300 é "VGA compatible
// controller"; o link `driver` some quando nenhum módulo assumiu o slot.
function slotsNoVfio() {
  const raiz = '/sys/bus/pci/devices';
  let itens;
  try { itens = fs.readdirSync(raiz); } catch (e) { return []; }

  const achados = [];
  for (const id of itens) {
    if (!leArquivo(path.join(raiz, id, 'class')).trim().startsWith('0x0300')) continue;
    let driver = '';
    try { driver = path.basename(fs.realpathSync(path.join(raiz, id, 'driver'))); } catch (e) { continue; }
    if (driver !== 'vfio-pci') continue;
    achados.push(id.replace(/^0000:/, ''));
  }
  return achados;
}

// `virsh domstate` responde no idioma da sessão, então "running" não serve de
// comparação. `list --name --state-running` devolve só nomes.
async function vmLigada() {
  const out = await roda('virsh', ['-c', 'qemu:///system', 'list', '--name', '--state-running'], 2000);
  return out.split('\n').map(l => l.trim()).includes(VM_DOMINIO);
}

function qga(json, ms) {
  return roda('virsh', ['-c', 'qemu:///system', 'qemu-agent-command', VM_DOMINIO, JSON.stringify(json)], ms || 3000);
}

// O guest-exec devolve um pid e sai; a saída só existe depois, no guest-exec-status.
async function nvidiaSmiNaVm() {
  const abriu = await qga({
    execute: 'guest-exec',
    arguments: {
      path: 'nvidia-smi',
      arg: CONSULTA_NVIDIA,
      'capture-output': true
    }
  });

  let pid;
  try { pid = JSON.parse(abriu).return.pid; } catch (e) { return ''; }

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300));
    let r;
    try { r = JSON.parse(await qga({ execute: 'guest-exec-status', arguments: { pid } })).return; } catch (e) { continue; }
    if (!r.exited) continue;
    if (!r['out-data']) return '';
    return Buffer.from(r['out-data'], 'base64').toString('utf8');
  }
  return '';
}

async function atualizaVm() {
  if (vmCache.buscando) return;
  vmCache.buscando = true;
  try {
    vmCache.linhas = (await vmLigada()) ? analisaNvidiaSmi(await nvidiaSmiNaVm()) : [];
  } catch (e) {
    vmCache.linhas = [];
  }
  vmCache.quando = Date.now();
  vmCache.buscando = false;
}

// Uma volta no agente custa dois comandos e uma espera: cara demais para o
// tique de 2 s. O retrato usa o que está em cache e dispara a próxima leitura
// por fora, sem segurar a resposta.
async function lerGpusVfio() {
  const slots = slotsNoVfio();
  if (!slots.length) return [];

  if (Date.now() - vmCache.quando > VM_INTERVALO) atualizaVm();

  const saida = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const daVm = vmCache.linhas[i] || null;
    // O nome sai do lspci mesmo quando a VM responde: trocar de rótulo no meio
    // remontaria o anel e mataria a animação dele a cada vez que a VM liga.
    saida.push({
      chave: 'vfio' + slot,
      marca: 'NVIDIA',
      nome: (await nomePci(slot)) || (daVm && daVm.nome) || 'GPU',
      naVm: true,
      uso: daVm ? daVm.uso : null,
      temp: daVm ? daVm.temp : null,
      vramUsada: daVm ? daVm.vramUsada : null,
      vramTotal: daVm ? daVm.vramTotal : null,
      watts: daVm ? daVm.watts : null,
      ventoinha: daVm ? daVm.ventoinha : null
    });
  }
  return saida;
}

// A NVIDIA vem primeiro por ser a placa de trabalho: é o anel que ele procura.
async function lerGpus() {
  const [nv, amd, vfio] = await Promise.all([lerGpusNvidia(), lerGpusAmd(), lerGpusVfio()]);
  return nv.concat(vfio).concat(amd);
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
  const [cpuUso, gpus] = [lerCpuUso(), await lerGpus()];
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
    // `gpu` é a primeira placa que tem sensor de verdade: o painel antigo e o
    // `get-temps` leem esse campo e ficariam em branco toda vez que a VM
    // estivesse desligada, porque a 3090 no vfio não publica temperatura no
    // host. `gpus` é a lista inteira, que o Mirante desenha.
    gpu: gpus.find(g => g && g.temp != null) || gpus[0] || null,
    gpus,
    memoria: lerMemoria(),
    discos: lerDiscos(),
    rede: lerRede(),
    nvme: temps.nvme,
    nvmeModelo: lerNvmeModelo(),
    uptime: lerUptime(),
    carga: lerCarga(),
    kernel: os.release(),
    distro: lerDistro(),
    host: os.hostname(),
    usuario: os.userInfo().username
  };
}

// ------------------------------------------------- coisas do desktop Arch

// Atualizações pendentes, dos dois lados: repositório oficial e AUR.
//
// `checkupdates` (pacman-contrib) usa uma cópia do banco em /tmp e NÃO mexe no
// pacman do sistema; `paru -Qua` só consulta o AUR. Os dois rodam sem sudo e
// sem alterar nada. Saída vazia com código 2 quer dizer "nada pendente".
//
// A conta que aparece na tela é uma só — o que ele quer saber é quanto falta
// atualizar —, mas a origem vem junto, porque atualizar AUR é recompilar e
// atualizar repo é baixar: é a diferença entre cinco minutos e cinco segundos.
function nomesDeLinhas(saida) {
  return saida.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' ')[0]);
}

async function pacotes() {
  // O AUR é consulta de rede pacote a pacote e pode demorar; o repo é local.
  const [repoBruto, aurBruto] = await Promise.all([
    roda('checkupdates', [], 20000),
    roda('paru', ['-Qua'], 45000)
  ]);
  const repo = nomesDeLinhas(repoBruto);
  const aur = nomesDeLinhas(aurBruto);
  return {
    total: repo.length + aur.length,
    repo: repo.length,
    aur: aur.length,
    // Os cinco primeiros dão para reconhecer se é atualização grande.
    amostra: repo.concat(aur).slice(0, 5)
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
