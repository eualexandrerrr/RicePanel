// Leituras da máquina: /proc, /sys e um binário ou outro que já existe no Arch.
//
// Porte do `sistema.js`. Uso (CPU, rede) é sempre delta entre dois retratos:
// contador cru não diz nada sozinho, então quem chama guarda o `Anterior`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::process::Command;

#[derive(Debug, Clone, Default)]
pub struct Cpu {
    pub pct: Option<u8>,
    pub modelo: String,
    pub ghz: Option<f32>,
    pub temp: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct Gpu {
    pub chave: String,
    pub marca: String,
    pub nome: String,
    pub na_vm: bool,
    pub uso: Option<u8>,
    pub temp: Option<i32>,
    pub vram_usada_mib: Option<u64>,
    pub vram_total_mib: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct Memoria {
    pub total: u64,
    pub usada: u64,
    pub pct: u8,
    pub swap_total: u64,
    pub swap_usado: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Disco {
    pub ponto: String,
    pub total: u64,
    pub usado: u64,
    pub pct: u8,
}

#[derive(Debug, Clone, Default)]
pub struct Rede {
    pub rx_bps: Option<f64>,
    pub tx_bps: Option<f64>,
    pub iface: String,
}

#[derive(Debug, Clone, Default)]
pub struct Retrato {
    pub cpu: Cpu,
    pub gpus: Vec<Gpu>,
    pub memoria: Option<Memoria>,
    pub discos: Vec<Disco>,
    pub rede: Rede,
    pub nvme_temp: Option<i32>,
    pub nvme_modelo: String,
    pub kernel: String,
    pub distro: String,
    pub host: String,
    pub usuario: String,
}

fn le(p: impl AsRef<Path>) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

fn num<T: std::str::FromStr>(s: &str) -> Option<T> {
    s.trim().parse().ok()
}

pub async fn roda(cmd: &str, args: &[&str], prazo: Duration) -> String {
    let filho = Command::new(cmd)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(prazo, filho).await {
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).into_owned(),
        _ => String::new(),
    }
}

// ------------------------------------------------------------------- CPU

#[derive(Default)]
struct CpuAnterior {
    ocioso: u64,
    soma: u64,
}

static CPU_ANTERIOR: Mutex<Option<CpuAnterior>> = Mutex::new(None);

fn cpu_uso() -> Option<u8> {
    let stat = le("/proc/stat");
    let linha = stat.lines().find(|l| l.starts_with("cpu "))?;
    let v: Vec<u64> = linha.split_whitespace().skip(1).filter_map(|s| s.parse().ok()).collect();
    if v.len() < 5 {
        return None;
    }
    let ocioso = v[3] + v[4];
    let soma: u64 = v.iter().sum();
    let mut guarda = CPU_ANTERIOR.lock().ok()?;
    let pct = guarda.as_ref().and_then(|a| {
        let ds = soma.saturating_sub(a.soma);
        let doc = ocioso.saturating_sub(a.ocioso);
        (ds > 0).then(|| ((1.0 - doc as f64 / ds as f64) * 100.0).round().clamp(0.0, 100.0) as u8)
    });
    *guarda = Some(CpuAnterior { ocioso, soma });
    pct
}

fn cpu_modelo() -> String {
    let info = le("/proc/cpuinfo");
    let Some(l) = info.lines().find(|l| l.starts_with("model name")) else { return String::new() };
    let bruto = l.split(':').nth(1).unwrap_or("").trim();
    let mut n = bruto.replace("(R)", "").replace("(TM)", "").replace("(tm)", "");
    if let Some(i) = n.find("-Core Processor") {
        let ini = n[..i].rfind(' ').unwrap_or(i);
        n.replace_range(ini..i + "-Core Processor".len(), "");
    }
    if let Some(i) = n.find("CPU @") {
        n.truncate(i);
    }
    n.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cpu_ghz() -> Option<f32> {
    let info = le("/proc/cpuinfo");
    let mhz: Vec<f32> = info
        .lines()
        .filter(|l| l.starts_with("cpu MHz"))
        .filter_map(|l| l.split(':').nth(1)?.trim().parse().ok())
        .collect();
    if mhz.is_empty() {
        return None;
    }
    Some((mhz.iter().sum::<f32>() / mhz.len() as f32 / 10.0).round() / 100.0)
}

// ------------------------------------------------------------ temperaturas

fn hwmon_temps() -> (Option<i32>, Option<i32>) {
    let mut cpu: Option<(i32, u8)> = None;
    let mut nvme: Option<(i32, bool)> = None;
    let Ok(dirs) = std::fs::read_dir("/sys/class/hwmon") else { return (None, None) };
    for d in dirs.flatten() {
        let base = d.path();
        let nome = le(base.join("name")).trim().to_string();
        let Ok(arqs) = std::fs::read_dir(&base) else { continue };
        for a in arqs.flatten() {
            let arq = a.file_name().to_string_lossy().into_owned();
            let Some(idx) = arq.strip_prefix("temp").and_then(|s| s.strip_suffix("_input")) else { continue };
            let Some(v) = num::<i64>(&le(a.path())) else { continue };
            let graus = ((v as f64) / 1000.0).round() as i32;
            if graus <= 0 || graus > 130 {
                continue;
            }
            let rotulo = le(base.join(format!("temp{idx}_label"))).trim().to_ascii_lowercase();
            if matches!(nome.as_str(), "k10temp" | "zenpower" | "coretemp") {
                let peso = if rotulo.contains("tccd") || rotulo.contains("package") || rotulo.contains("tdie") {
                    2
                } else if rotulo.contains("tctl") {
                    1
                } else {
                    0
                };
                if cpu.map(|(_, p)| peso > p).unwrap_or(true) {
                    cpu = Some((graus, peso));
                }
            }
            if nome.contains("nvme") {
                let composto = rotulo.contains("composite");
                if nvme.map(|(_, c)| !c && composto).unwrap_or(true) {
                    nvme = Some((graus, composto));
                }
            }
        }
    }
    (cpu.map(|c| c.0), nvme.map(|n| n.0))
}

fn nvme_modelo() -> String {
    let Ok(dirs) = std::fs::read_dir("/sys/class/nvme") else { return String::new() };
    let mut nomes: Vec<PathBuf> = dirs.flatten().map(|d| d.path()).collect();
    nomes.sort();
    for d in nomes {
        let m = le(d.join("model")).trim().to_string();
        if m.is_empty() {
            continue;
        }
        const MARCAS: [&str; 12] = [
            "Corsair", "Samsung", "Kingston", "WDC", "WD", "Western Digital", "Seagate", "Crucial", "ADATA",
            "Sabrent", "Intel", "Micron",
        ];
        for marca in MARCAS {
            if let Some(resto) = m.strip_prefix(marca) {
                if resto.starts_with(' ') {
                    return resto.trim().to_string();
                }
            }
        }
        return m;
    }
    String::new()
}

// --------------------------------------------------------------------- GPU

static NOMES_PCI: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn limpa_nome_gpu(bruto: &str) -> String {
    if bruto.to_ascii_lowercase().contains("lexa") {
        return "Radeon RX 550".into();
    }
    let mut n = bruto.replace("(R)", "").replace("(TM)", "").replace("GeForce ", "");
    if let Some(i) = n.find("Advanced Micro Devices") {
        let fim = n[i..].find('[').map(|f| i + f).unwrap_or(n.len());
        n.replace_range(i..fim, "");
    }
    let n = n.trim().to_string();
    if let (Some(a), Some(b)) = (n.find('['), n.find(']')) {
        if a < b {
            let dentro = &n[a + 1..b];
            return dentro.split(" / ").next().unwrap_or(dentro).split('/').next().unwrap_or(dentro).trim().to_string();
        }
    }
    n
}

async fn nome_pci(slot: &str) -> String {
    if let Ok(g) = NOMES_PCI.lock() {
        if let Some(n) = g.as_ref().and_then(|m| m.get(slot)) {
            return n.clone();
        }
    }
    let out = roda("lspci", &["-mm", "-s", slot], Duration::from_secs(2)).await;
    let campos: Vec<&str> = out.split('"').skip(1).step_by(2).collect();
    let nome = limpa_nome_gpu(campos.get(2).copied().unwrap_or(""));
    if let Ok(mut g) = NOMES_PCI.lock() {
        g.get_or_insert_with(HashMap::new).insert(slot.to_string(), nome.clone());
    }
    nome
}

const CONSULTA_NVIDIA: [&str; 2] = [
    "--query-gpu=index,name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed",
    "--format=csv,noheader,nounits",
];

fn analisa_nvidia_smi(out: &str) -> Vec<Gpu> {
    out.lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(',').map(str::trim).collect();
            if p.len() < 8 || !p[0].chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            Some(Gpu {
                chave: format!("nvidia{}", p[0]),
                marca: "NVIDIA".into(),
                nome: limpa_nome_gpu(p[1]),
                na_vm: false,
                uso: num(p[2]),
                temp: num(p[3]),
                vram_usada_mib: num(p[4]),
                vram_total_mib: num(p[5]),
            })
        })
        .collect()
}

fn placas_video_por_driver(driver_quer: &str) -> Vec<String> {
    let Ok(itens) = std::fs::read_dir("/sys/bus/pci/devices") else { return vec![] };
    let mut saida = vec![];
    for it in itens.flatten() {
        let p = it.path();
        if !le(p.join("class")).trim().starts_with("0x0300") {
            continue;
        }
        let Ok(driver) = std::fs::read_link(p.join("driver")) else { continue };
        let driver = driver.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if driver == driver_quer {
            saida.push(it.file_name().to_string_lossy().trim_start_matches("0000:").to_string());
        }
    }
    saida
}

async fn gpus_nvidia() -> Vec<Gpu> {
    if placas_video_por_driver("nvidia").is_empty() {
        return vec![];
    }
    analisa_nvidia_smi(&roda("nvidia-smi", &CONSULTA_NVIDIA, Duration::from_secs(3)).await)
}

async fn gpus_amd() -> Vec<Gpu> {
    let Ok(dirs) = std::fs::read_dir("/sys/class/hwmon") else { return vec![] };
    let mut bases: Vec<PathBuf> = dirs.flatten().map(|d| d.path()).collect();
    bases.sort();
    let mut saida = vec![];
    for base in bases {
        if le(base.join("name")).trim() != "amdgpu" {
            continue;
        }
        let Ok(dev) = std::fs::canonicalize(base.join("device")) else { continue };
        let slot = dev.file_name().map(|s| s.to_string_lossy().trim_start_matches("0000:").to_string()).unwrap_or_default();
        let mut temp: Option<(i32, i8)> = None;
        if let Ok(arqs) = std::fs::read_dir(&base) {
            for a in arqs.flatten() {
                let arq = a.file_name().to_string_lossy().into_owned();
                let Some(idx) = arq.strip_prefix("temp").and_then(|s| s.strip_suffix("_input")) else { continue };
                let Some(v) = num::<i64>(&le(a.path())) else { continue };
                let graus = (v as f64 / 1000.0).round() as i32;
                if graus <= 0 || graus > 130 {
                    continue;
                }
                let rotulo = le(base.join(format!("temp{idx}_label"))).trim().to_ascii_lowercase();
                let peso = if rotulo.contains("edge") { 2 } else if rotulo.contains("junction") || rotulo.contains("mem") { 0 } else { 1 };
                if temp.map(|(_, p)| peso > p).unwrap_or(true) {
                    temp = Some((graus, peso));
                }
            }
        }
        let mib = |p: &str| num::<u64>(&le(dev.join(p))).map(|b| b / 1_048_576);
        saida.push(Gpu {
            chave: format!("amd{slot}"),
            marca: "AMD".into(),
            nome: {
                let n = nome_pci(&slot).await;
                if n.is_empty() { "Radeon".into() } else { n }
            },
            na_vm: false,
            uso: num(&le(dev.join("gpu_busy_percent"))),
            temp: temp.map(|t| t.0),
            vram_usada_mib: mib("mem_info_vram_used"),
            vram_total_mib: mib("mem_info_vram_total"),
        });
    }
    saida
}

// GPU presa no vfio: quem lê os sensores é o Windows da VM, pelo guest-agent.
const VM_DOMINIO: &str = "w11";
const VM_INTERVALO: Duration = Duration::from_secs(5);

struct VmCache {
    quando: Option<Instant>,
    linhas: Vec<Gpu>,
    buscando: bool,
}

static VM_CACHE: Mutex<VmCache> = Mutex::new(VmCache { quando: None, linhas: Vec::new(), buscando: false });

async fn qga(json: &str, prazo: Duration) -> String {
    roda("virsh", &["-c", "qemu:///system", "qemu-agent-command", VM_DOMINIO, json], prazo).await
}

async fn vm_ligada() -> bool {
    let out = roda("virsh", &["-c", "qemu:///system", "list", "--name", "--state-running"], Duration::from_secs(2)).await;
    out.lines().any(|l| l.trim() == VM_DOMINIO)
}

fn campo_json<'a>(texto: &'a str, chave: &str) -> Option<&'a str> {
    let i = texto.find(&format!("\"{chave}\""))? + chave.len() + 2;
    let resto = texto[i..].trim_start_matches([':', ' ']);
    let fim = resto.find([',', '}']).unwrap_or(resto.len());
    Some(resto[..fim].trim().trim_matches('"'))
}

async fn nvidia_smi_na_vm() -> String {
    let pedido = format!(
        "{{\"execute\":\"guest-exec\",\"arguments\":{{\"path\":\"nvidia-smi\",\"arg\":[\"{}\",\"{}\"],\"capture-output\":true}}}}",
        CONSULTA_NVIDIA[0], CONSULTA_NVIDIA[1]
    );
    let abriu = qga(&pedido, Duration::from_secs(3)).await;
    let Some(pid) = campo_json(&abriu, "pid") else { return String::new() };
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let r = qga(&format!("{{\"execute\":\"guest-exec-status\",\"arguments\":{{\"pid\":{pid}}}}}"), Duration::from_secs(3)).await;
        if campo_json(&r, "exited") != Some("true") {
            continue;
        }
        let Some(b64) = campo_json(&r, "out-data") else { return String::new() };
        return decodifica_base64(b64);
    }
    String::new()
}

fn decodifica_base64(s: &str) -> String {
    const TABELA: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut saida = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in s.bytes() {
        let Some(v) = TABELA.iter().position(|&t| t == c) else { continue };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            saida.push(((acc >> bits) & 0xff) as u8);
        }
    }
    String::from_utf8_lossy(&saida).into_owned()
}

async fn atualiza_vm() {
    {
        let Ok(mut c) = VM_CACHE.lock() else { return };
        if c.buscando {
            return;
        }
        c.buscando = true;
    }
    let linhas = if vm_ligada().await { analisa_nvidia_smi(&nvidia_smi_na_vm().await) } else { vec![] };
    if let Ok(mut c) = VM_CACHE.lock() {
        c.linhas = linhas;
        c.quando = Some(Instant::now());
        c.buscando = false;
    }
}

async fn gpus_vfio() -> Vec<Gpu> {
    let slots = placas_video_por_driver("vfio-pci");
    if slots.is_empty() {
        return vec![];
    }
    let precisa = VM_CACHE
        .lock()
        .map(|c| c.quando.map(|q| q.elapsed() > VM_INTERVALO).unwrap_or(true))
        .unwrap_or(false);
    if precisa {
        tokio::spawn(atualiza_vm());
    }
    let linhas = VM_CACHE.lock().map(|c| c.linhas.clone()).unwrap_or_default();
    let mut saida = vec![];
    for (i, slot) in slots.iter().enumerate() {
        let da_vm = linhas.get(i);
        let nome = {
            let n = nome_pci(slot).await;
            if !n.is_empty() { n } else { da_vm.map(|g| g.nome.clone()).unwrap_or_else(|| "GPU".into()) }
        };
        saida.push(Gpu {
            chave: format!("vfio{slot}"),
            marca: "NVIDIA".into(),
            nome,
            na_vm: true,
            uso: da_vm.and_then(|g| g.uso),
            temp: da_vm.and_then(|g| g.temp),
            vram_usada_mib: da_vm.and_then(|g| g.vram_usada_mib),
            vram_total_mib: da_vm.and_then(|g| g.vram_total_mib),
        });
    }
    saida
}

pub async fn gpus() -> Vec<Gpu> {
    let (nv, vfio, amd) = tokio::join!(gpus_nvidia(), gpus_vfio(), gpus_amd());
    nv.into_iter().chain(vfio).chain(amd).collect()
}

// ----------------------------------------------------------------- memória

fn memoria() -> Option<Memoria> {
    let info = le("/proc/meminfo");
    let campo = |n: &str| -> Option<u64> {
        info.lines()
            .find(|l| l.starts_with(n))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse::<u64>().ok())
            .map(|kb| kb * 1024)
    };
    let total = campo("MemTotal:")?;
    let disp = campo("MemAvailable:")?;
    let swap_total = campo("SwapTotal:").unwrap_or(0);
    let swap_livre = campo("SwapFree:").unwrap_or(0);
    let usada = total.saturating_sub(disp);
    Some(Memoria {
        total,
        usada,
        pct: ((usada as f64 / total as f64) * 100.0).round() as u8,
        swap_total,
        swap_usado: swap_total.saturating_sub(swap_livre),
    })
}

// ------------------------------------------------------------------ discos

fn statfs(ponto: &str) -> Option<(u64, u64, u64)> {
    use std::ffi::CString;
    let c = CString::new(ponto).ok()?;
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let bsize = st.f_bsize as u64;
    Some((st.f_blocks as u64 * bsize, st.f_bavail as u64 * bsize, st.f_blocks as u64))
}

fn discos() -> Vec<Disco> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home".into());
    let mut vistos = std::collections::HashSet::new();
    let mut saida = vec![];
    for ponto in ["/", home.as_str()] {
        let Some((total, livre, blocos)) = statfs(ponto) else { continue };
        if total == 0 || !vistos.insert((total, blocos)) {
            continue;
        }
        saida.push(Disco {
            ponto: if ponto == "/" { "/".into() } else { "~".into() },
            total,
            usado: total - livre,
            pct: (((total - livre) as f64 / total as f64) * 100.0).round() as u8,
        });
    }
    saida
}

// -------------------------------------------------------------------- rede

struct RedeAnterior {
    rx: u64,
    tx: u64,
    quando: Instant,
}

static REDE_ANTERIOR: Mutex<Option<RedeAnterior>> = Mutex::new(None);

fn rede() -> Rede {
    let dev = le("/proc/net/dev");
    let (mut rx, mut tx) = (0u64, 0u64);
    let mut ativas = vec![];
    for l in dev.lines().skip(2) {
        let Some((iface, resto)) = l.split_once(':') else { continue };
        let iface = iface.trim();
        if iface == "lo" || ["docker", "veth", "br-", "virbr"].iter().any(|p| iface.starts_with(p)) {
            continue;
        }
        let v: Vec<u64> = resto.split_whitespace().filter_map(|s| s.parse().ok()).collect();
        if v.len() < 9 {
            continue;
        }
        if v[0] > 0 || v[8] > 0 {
            ativas.push(iface.to_string());
        }
        rx += v[0];
        tx += v[8];
    }
    let iface = ativas.into_iter().next().unwrap_or_default();
    let agora = Instant::now();
    let Ok(mut g) = REDE_ANTERIOR.lock() else { return Rede { rx_bps: None, tx_bps: None, iface } };
    let saida = match g.as_ref() {
        Some(a) => {
            let dt = agora.duration_since(a.quando).as_secs_f64();
            if dt > 0.0 {
                Rede {
                    rx_bps: Some(rx.saturating_sub(a.rx) as f64 / dt),
                    tx_bps: Some(tx.saturating_sub(a.tx) as f64 / dt),
                    iface,
                }
            } else {
                Rede { rx_bps: None, tx_bps: None, iface }
            }
        }
        None => Rede { rx_bps: None, tx_bps: None, iface },
    };
    *g = Some(RedeAnterior { rx, tx, quando: agora });
    saida
}

// ---------------------------------------------------------------- o resto

fn distro() -> String {
    le("/etc/os-release")
        .lines()
        .find_map(|l| l.strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim_matches('"').to_string())
        .unwrap_or_else(|| "Linux".into())
}

fn kernel() -> String {
    le("/proc/sys/kernel/osrelease").trim().to_string()
}

fn host() -> String {
    le("/proc/sys/kernel/hostname").trim().to_string()
}

pub async fn retrato() -> Retrato {
    let gpus = gpus().await;
    let (temp_cpu, temp_nvme) = hwmon_temps();
    Retrato {
        cpu: Cpu { pct: cpu_uso(), modelo: cpu_modelo(), ghz: cpu_ghz(), temp: temp_cpu },
        gpus,
        memoria: memoria(),
        discos: discos(),
        rede: rede(),
        nvme_temp: temp_nvme,
        nvme_modelo: nvme_modelo(),
        kernel: kernel(),
        distro: distro(),
        host: host(),
        usuario: std::env::var("USER").unwrap_or_default(),
    }
}

// ------------------------------------------------------ pacotes pendentes

#[derive(Debug, Clone, Default)]
pub struct Pacotes {
    pub repo: usize,
    pub aur: usize,
}

impl Pacotes {
    pub fn total(&self) -> usize {
        self.repo + self.aur
    }
}

// `checkupdates` usa uma cópia do banco e não mexe no pacman; `paru -Qua` só
// consulta o AUR. Os dois sem sudo e sem alterar nada.
pub async fn pacotes() -> Pacotes {
    let conta = |s: String| s.lines().filter(|l| !l.trim().is_empty()).count();
    let (repo, aur) = tokio::join!(
        roda("checkupdates", &[], Duration::from_secs(20)),
        roda("paru", &["-Qua"], Duration::from_secs(45))
    );
    Pacotes { repo: conta(repo), aur: conta(aur) }
}

pub fn fmt_gb(bytes: u64) -> String {
    let gb = bytes as f64 / 1_073_741_824.0;
    if gb >= 100.0 {
        format!("{:.0} GB", gb)
    } else if gb >= 10.0 {
        format!("{:.0} GB", gb)
    } else {
        format!("{:.1} GB", gb).replace('.', ",")
    }
}

pub fn fmt_taxa(bps: Option<f64>) -> String {
    let Some(b) = bps else { return "—".into() };
    let kb = b / 1024.0;
    if kb < 1.0 {
        "0 KB/s".into()
    } else if kb < 1024.0 {
        format!("{:.0} KB/s", kb)
    } else {
        format!("{:.1} MB/s", kb / 1024.0).replace('.', ",")
    }
}
