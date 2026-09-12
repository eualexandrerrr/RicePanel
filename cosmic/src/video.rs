// Vídeo do navegador redirecionado para o Mirante.
//
// Quando ele está vendo algo no navegador e sai daquele workspace, o vídeo
// continua na parede; quando volta, o painel devolve. Tudo opt-in pela chave
// `video_ligado`: puxar o vídeo pausa a aba dele.
//
// De onde vem: MPRIS (`playerctl`) dá título, posição e estado da aba que
// toca. A URL não vem pelo MPRIS: sai do histórico do Chrome (SQLite, copiado
// porque o original fica travado). Quem toca é o GStreamer com o fluxo que o
// `yt-dlp` resolve — sem Chromium, sem anúncio, decodificado em VP9 pela CPU
// a 720p. Serviço com DRM (Globoplay, Netflix) não tem fluxo aberto: a placa
// avisa que o vídeo fica no navegador.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;

use crate::sistema::roda;

const PRAZO: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, PartialEq, Default)]
pub enum Site {
    #[default]
    Nenhum,
    Youtube(String),
    Drm,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidato {
    pub aba: i64,
    pub site: Site,
    pub titulo: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Estado {
    /// Aba do Chrome (pela extensão). `None` no caminho antigo, por MPRIS.
    pub aba: Option<i64>,
    /// Com mais de um vídeo tocando fora da vista, a lista para ele escolher.
    pub candidatos: Vec<Candidato>,
    pub site: Site,
    pub titulo: String,
    pub posicao: Option<u64>,
    pub duracao: Option<u64>,
    pub tocando: bool,
    pub a_vista: bool,
    pub player: String,
    pub volume: Option<f64>,
}

impl Estado {
    pub fn assinatura(&self) -> String {
        let base = match &self.site {
            Site::Nenhum => return String::new(),
            Site::Youtube(id) => format!("youtube:{id}"),
            Site::Drm => format!("drm:{}", self.titulo),
        };
        base + &self.aba.map(|a| format!("@{a}")).unwrap_or_default()
    }
}

// ------------------------------------------------------------ quem toca

fn eh_navegador(nome: &str) -> bool {
    let n = nome.to_ascii_lowercase();
    ["chromium", "chrome", "firefox", "brave", "vivaldi"].iter().any(|p| n.starts_with(p))
}

fn eh_app_navegador(app_id: &str) -> bool {
    let a = app_id.to_ascii_lowercase();
    ["chrome", "chromium", "firefox", "brave", "vivaldi"].iter().any(|p| a.contains(p))
}

const SEP: &str = "\u{1f}";

struct Meta {
    tocando: bool,
    titulo: String,
    capa: String,
    duracao: Option<u64>,
    posicao: Option<u64>,
}

async fn metadados(player: &str) -> Option<Meta> {
    let formato = ["{{status}}", "{{title}}", "{{mpris:artUrl}}", "{{mpris:length}}", "{{position}}"].join(SEP);
    let bruto = roda("playerctl", &["-p", player, "metadata", "--format", &formato], PRAZO).await;
    let p: Vec<&str> = bruto.trim().split(SEP).collect();
    if p.len() < 3 || p[1].is_empty() {
        return None;
    }
    let micros = |s: &str| s.trim().parse::<f64>().ok().filter(|v| *v > 0.0).map(|v| (v / 1e6).round() as u64);
    Some(Meta {
        tocando: p[0].to_ascii_lowercase().contains("playing"),
        titulo: p[1].to_string(),
        capa: p.get(2).unwrap_or(&"").to_string(),
        duracao: p.get(3).and_then(|s| micros(s)),
        posicao: p.get(4).and_then(|s| micros(s)),
    })
}

fn youtube_da_capa(capa: &str) -> Option<String> {
    let i = capa.find("/vi/")? + 4;
    let resto = &capa[i..];
    let fim = resto.find('/')?;
    let id = &resto[..fim];
    (id.len() >= 6 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).then(|| id.to_string())
}

// ------------------------------------------------- a URL, pelo histórico

const PERFIS: [&str; 4] = [
    ".config/google-chrome/Default/History",
    ".config/chromium/Default/History",
    ".config/BraveSoftware/Brave-Browser/Default/History",
    ".config/vivaldi/Default/History",
];

// O Chrome põe a contagem de não lidas na frente ("(16) Título - YouTube") e
// o nome do site atrás; o MPRIS publica só o miolo.
pub fn miolo(titulo: &str) -> String {
    let mut t = titulo.trim();
    if t.starts_with('(') {
        if let Some(f) = t.find(')') {
            if t[1..f].chars().all(|c| c.is_ascii_digit()) {
                t = t[f + 1..].trim_start();
            }
        }
    }
    let baixo = t.to_lowercase();
    let baixo = baixo.trim_end_matches(" - youtube").trim_end_matches(" - globoplay").trim();
    baixo.to_string()
}

static CACHE_URL: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static COPIA_EM: Mutex<Option<std::time::Instant>> = Mutex::new(None);

fn copia_historico() -> Option<PathBuf> {
    let destino = crate::vidro::dir_cache().join("historico.db");
    let recente = COPIA_EM
        .lock()
        .ok()
        .and_then(|g| g.map(|t| t.elapsed() < Duration::from_secs(60)))
        .unwrap_or(false);
    if recente && destino.exists() {
        return Some(destino);
    }
    let home = std::env::var("HOME").ok()?;
    for rel in PERFIS {
        let origem = PathBuf::from(&home).join(rel);
        if !origem.exists() {
            continue;
        }
        let _ = std::fs::create_dir_all(crate::vidro::dir_cache());
        if std::fs::copy(&origem, &destino).is_ok() {
            if let Ok(mut g) = COPIA_EM.lock() {
                *g = Some(std::time::Instant::now());
            }
            return Some(destino);
        }
    }
    None
}

async fn url_do_titulo(titulo: &str, padrao: &str) -> String {
    let chave = miolo(titulo);
    if chave.is_empty() {
        return String::new();
    }
    let k = format!("{padrao}|{chave}");
    if let Some(v) = CACHE_URL.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(&k).cloned())) {
        return v;
    }
    let Some(copia) = copia_historico() else { return String::new() };
    let sql = format!("select url, title from urls where url like '{padrao}' order by last_visit_time desc limit 40");
    let bruto = roda("sqlite3", &["-separator", SEP, &copia.to_string_lossy(), &sql], Duration::from_secs(3)).await;
    let linhas: Vec<(String, String)> = bruto
        .lines()
        .filter_map(|l| l.split_once(SEP).map(|(u, t)| (u.to_string(), t.to_string())))
        .collect();
    let exato = linhas.iter().find(|(_, t)| miolo(t) == chave);
    let perto = linhas.iter().find(|(_, t)| {
        let m = miolo(t);
        !m.is_empty() && (m.contains(&chave) || chave.contains(&m))
    });
    let achou = exato.or(perto).map(|(u, _)| u.clone()).unwrap_or_default();
    if let Ok(mut g) = CACHE_URL.lock() {
        let m = g.get_or_insert_with(HashMap::new);
        if m.len() > 30 {
            m.clear();
        }
        m.insert(k, achou.clone());
    }
    achou
}

fn id_da_url_youtube(url: &str) -> Option<String> {
    let i = url.find("v=").map(|i| i + 2).or_else(|| url.find("youtu.be/").map(|i| i + 9))?;
    let id: String = url[i..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    (id.len() >= 6).then_some(id)
}

// ------------------------------------------------------ volume do navegador

async fn volume_do_navegador() -> Option<f64> {
    let bruto = roda("pactl", &["list", "sink-inputs"], Duration::from_millis(2500)).await;
    for bloco in bruto.split("Sink Input #").skip(1) {
        let b = bloco.to_ascii_lowercase();
        if !["chrome", "chromium", "brave", "vivaldi", "firefox"].iter().any(|n| b.contains(n)) {
            continue;
        }
        let linha = bloco.lines().find(|l| l.trim_start().starts_with("Volume:"))?;
        let pct = linha.split('%').next()?.rsplit(' ').next()?.trim().parse::<f64>().ok()?;
        return Some((pct / 100.0).clamp(0.0, 1.0));
    }
    None
}

static ULTIMO_VOLUME: Mutex<Option<f64>> = Mutex::new(None);

// --------------------------------------------------------------- olhar

fn a_vista(titulo: &str) -> bool {
    let chave: String = miolo(titulo).chars().take(24).collect();
    if chave.is_empty() {
        return true;
    }
    let janelas = crate::janelas::atual();
    if janelas.janelas.is_empty() {
        return true; // sem retrato do compositor, não rouba o vídeo de ninguém
    }
    janelas
        .janelas
        .iter()
        .filter(|j| eh_app_navegador(&j.app_id) && miolo(&j.titulo).contains(&chave))
        .any(|j| j.a_vista)
}

fn site_da_url(url: &str) -> Site {
    if url.contains("globoplay.globo.com") {
        return Site::Drm;
    }
    match id_da_url_youtube(url).or_else(|| {
        let i = url.find("/live/")? + 6;
        let id: String = url[i..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        (id.len() >= 6).then_some(id)
    }) {
        Some(id) => Site::Youtube(id),
        None => Site::Nenhum,
    }
}

// A aba está à vista quando é a aba ativa da janela e essa janela está num
// workspace ativo. Aba de fundo nunca está à vista, mesmo com a janela na frente.
fn aba_a_vista(a: &crate::ponte::Aba) -> bool {
    if !a.ativa {
        return false;
    }
    a_vista(&a.titulo)
}

// Caminho principal: a extensão diz exatamente o que toca, com o volume real.
// `escolhida` é a aba que ele apontou quando havia mais de uma.
async fn olhar_pela_extensao(abas: Vec<crate::ponte::Aba>, escolhida: Option<i64>, montada: Option<i64>) -> Estado {
    let fluxo = volume_do_navegador().await;
    // Uma aba que o painel pausou continua sendo o vídeo dele: sem isso ela sairia
    // da lista no momento em que a parede começa a tocar.
    let candidatas: Vec<&crate::ponte::Aba> = abas
        .iter()
        .filter(|a| site_da_url(&a.url) != Site::Nenhum)
        .filter(|a| (a.tocando || Some(a.aba) == montada) && !aba_a_vista(a))
        .collect();
    if candidatas.is_empty() {
        return Estado::default();
    }
    let alvo = candidatas
        .iter()
        .find(|a| Some(a.aba) == montada)
        .or_else(|| candidatas.iter().find(|a| Some(a.aba) == escolhida))
        .or_else(|| (candidatas.len() == 1).then(|| &candidatas[0]));
    let Some(a) = alvo else {
        return Estado {
            candidatos: candidatas
                .iter()
                .map(|a| Candidato { aba: a.aba, site: site_da_url(&a.url), titulo: a.titulo.clone() })
                .collect(),
            ..Default::default()
        };
    };
    if a.volume > 0.0 || fluxo.is_some() {
        if let Ok(mut g) = ULTIMO_VOLUME.lock() {
            *g = Some(a.volume * fluxo.unwrap_or(1.0));
        }
    }
    Estado {
        aba: Some(a.aba),
        candidatos: Vec::new(),
        site: site_da_url(&a.url),
        titulo: a.titulo.clone(),
        posicao: Some(a.posicao.max(0.0) as u64),
        duracao: a.duracao.map(|d| d as u64),
        tocando: a.tocando,
        a_vista: false,
        player: String::new(),
        volume: ULTIMO_VOLUME.lock().ok().and_then(|g| *g),
    }
}

pub async fn olhar(ligado: bool, escolhida: Option<i64>, montada: Option<i64>) -> Estado {
    if !ligado {
        return Estado::default();
    }
    if std::env::var_os("RICEPANEL_VIDEO_FAKE").is_none() {
        if let Some(abas) = crate::ponte::abas() {
            return olhar_pela_extensao(abas, escolhida, montada).await;
        }
    }
    if let Some(f) = std::env::var_os("RICEPANEL_VIDEO_FAKE") {
        let f = f.to_string_lossy().into_owned();
        let (tipo, id) = f.split_once(':').unwrap_or((f.as_str(), "dQw4w9WgXcQ"));
        return Estado {
            site: if tipo == "youtube" { Site::Youtube(id.to_string()) } else { Site::Drm },
            titulo: "Teste de placa de vídeo".into(),
            posicao: Some(0),
            tocando: true,
            a_vista: false,
            // O teste também lê o volume do player do YouTube, para conferir
            // que o painel toca no volume que está no Chrome.
            volume: tokio::task::spawn_blocking(crate::volume_chrome::volume_youtube).await.ok().flatten(),
            ..Default::default()
        };
    }
    let lista = roda("playerctl", &["-l"], PRAZO).await;
    for player in lista.lines().map(str::trim).filter(|p| !p.is_empty() && eh_navegador(p)) {
        let Some(m) = metadados(player).await else { continue };
        let mut id = youtube_da_capa(&m.capa);
        if id.is_none() {
            id = id_da_url_youtube(&url_do_titulo(&m.titulo, "%youtube.com/watch%").await);
        }
        let drm = id.is_none() && !url_do_titulo(&m.titulo, "%globoplay%").await.is_empty();
        if id.is_none() && !drm {
            continue;
        }
        // Volume final = controle do player do YouTube × fluxo do Chrome no
        // PipeWire. O primeiro é o que ele mexe; o segundo quase sempre é 100%.
        // Com a aba pausada pelo painel o fluxo some: fica o último lido.
        let fluxo = volume_do_navegador().await;
        let pagina = tokio::task::spawn_blocking(crate::volume_chrome::volume_youtube).await.ok().flatten();
        if fluxo.is_some() || pagina.is_some() {
            let anterior = ULTIMO_VOLUME.lock().ok().and_then(|g| *g);
            let v = pagina.unwrap_or(1.0) * fluxo.or(anterior.map(|_| 1.0)).unwrap_or(1.0);
            if let Ok(mut g) = ULTIMO_VOLUME.lock() {
                *g = Some(v);
            }
        }
        let volume = ULTIMO_VOLUME.lock().ok().and_then(|g| *g);
        return Estado {
            aba: None,
            candidatos: Vec::new(),
            site: id.map(Site::Youtube).unwrap_or(Site::Drm),
            a_vista: a_vista(&m.titulo),
            titulo: m.titulo,
            posicao: m.posicao,
            duracao: m.duracao,
            tocando: m.tocando,
            player: player.to_string(),
            volume,
        };
    }
    Estado::default()
}

pub async fn pausa_navegador(player: String, aba: Option<i64>) {
    if let Some(a) = aba {
        crate::ponte::comando("pausar", a);
        return;
    }
    if !player.is_empty() {
        roda("playerctl", &["-p", &player, "pause"], PRAZO).await;
    }
}

pub async fn toca_navegador(player: String, aba: Option<i64>) {
    if let Some(a) = aba {
        crate::ponte::comando("retomar", a);
        return;
    }
    if !player.is_empty() {
        roda("playerctl", &["-p", &player, "play"], PRAZO).await;
    }
}

// ------------------------------------------------------------- yt-dlp

fn yt_dlp() -> PathBuf {
    let local = std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/bin/yt-dlp")).ok();
    match local {
        Some(p) if p.exists() => p,
        _ => PathBuf::from("yt-dlp"),
    }
}

// Vídeo VP9 até 720p e áudio Opus, em URLs diretas (sem HLS/DASH: o GStreamer
// daqui não tem esses demuxers). Sem cookies: o fluxo do yt-dlp não tem
// anúncio de qualquer jeito, e cookie de sessão do Chrome no yt-dlp o Google
// recusa ("The page needs to be reloaded").
pub async fn urls_youtube(id: &str) -> Result<(String, String), String> {
    // Gravado: webm VP9 + Opus, que decodifica com o que já está instalado.
    // Ao vivo: o YouTube só entrega HLS com H.264 + AAC, 30 fps antes de 60.
    let formato = "bv*[height<=720][vcodec=vp9][ext=webm]+ba[acodec=opus][ext=webm]\
        /bv*[height<=720][ext=webm]+ba[ext=webm]\
        /bv*[height<=720][fps<=30][protocol^=m3u8]+ba[protocol^=m3u8]\
        /bv*[height<=720][protocol^=m3u8]+ba[protocol^=m3u8]\
        /b[height<=720]";
    let bin = yt_dlp();
    let saida = tokio::time::timeout(
        Duration::from_secs(25),
        tokio::process::Command::new(&bin)
            .args(["--no-warnings", "--js-runtimes", "node", "--remote-components", "ejs:github", "-f", formato, "-g"])
            .arg(format!("https://www.youtube.com/watch?v={id}"))
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp demorou demais".to_string())?
    .map_err(|e| format!("yt-dlp: {e}"))?;
    let texto = String::from_utf8_lossy(&saida.stdout);
    let mut linhas = texto.lines().filter(|l| l.starts_with("http"));
    let video = linhas.next().ok_or_else(|| {
        let erro = String::from_utf8_lossy(&saida.stderr);
        format!("yt-dlp sem URL: {}", erro.lines().last().unwrap_or("").chars().take(120).collect::<String>())
    })?;
    let audio = linhas.next().unwrap_or(video);
    Ok((video.to_string(), audio.to_string()))
}

// ------------------------------------------------------------- player

pub struct Quadro {
    pub largura: u32,
    pub altura: u32,
    pub rgba: Vec<u8>,
}

pub struct Player {
    pipeline: gst::Pipeline,
    quadro: Arc<Mutex<Option<Quadro>>>,
    volume: Option<gst::Element>,
}

impl Player {
    pub fn tocar(video: &str, audio: &str, inicio_s: u64, volume: Option<f64>, largura: u32) -> Result<Player, String> {
        let (lw, lh) = (largura.max(320) & !1, ((largura.max(320) * 9 / 16) & !1));
        gst::init().map_err(|e| e.to_string())?;
        // `uridecodebin3`, não o antigo: live do YouTube é HLS, e só a versão 3
        // encaixa o `hlsdemux2`. O `uridecodebin` procura o `hlsdemux` legado,
        // que não está instalado, e morre com "plug-in faltando".
        let mesmo = video == audio;
        let descricao = if mesmo {
            format!(
                "uridecodebin3 uri=\"{video}\" name=d \
                 d. ! queue ! videoconvert ! videoscale ! video/x-raw,format=RGBA,width={lw},height={lh},pixel-aspect-ratio=1/1 ! appsink name=v sync=true max-buffers=1 drop=true \
                 d. ! queue ! audioconvert ! audioresample ! volume name=vol ! autoaudiosink"
            )
        } else {
            format!(
                "uridecodebin3 uri=\"{video}\" ! queue ! videoconvert ! videoscale ! video/x-raw,format=RGBA,width={lw},height={lh},pixel-aspect-ratio=1/1 ! appsink name=v sync=true max-buffers=1 drop=true \
                 uridecodebin3 uri=\"{audio}\" ! queue ! audioconvert ! audioresample ! volume name=vol ! autoaudiosink"
            )
        };
        let elemento = gst::parse::launch_full(&descricao, None, gst::ParseFlags::empty()).map_err(|e| e.to_string())?;
        let pipeline = elemento.downcast::<gst::Pipeline>().map_err(|_| "pipeline inválido")?;
        let sink = pipeline
            .by_name("v")
            .and_then(|e| e.downcast::<gst_app::AppSink>().ok())
            .ok_or("appsink ausente")?;
        let quadro = Arc::new(Mutex::new(None));
        let destino = quadro.clone();
        sink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |s| {
                    let amostra = s.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    let buffer = amostra.buffer().ok_or(gst::FlowError::Error)?;
                    let caps = amostra.caps().ok_or(gst::FlowError::Error)?;
                    let info = gstreamer_video::VideoInfo::from_caps(caps).map_err(|_| gst::FlowError::Error)?;
                    let mapa = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
                    if let Ok(mut g) = destino.lock() {
                        *g = Some(Quadro { largura: info.width(), altura: info.height(), rgba: mapa.as_slice().to_vec() });
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );
        let vol = pipeline.by_name("vol");
        if let (Some(v), Some(valor)) = (&vol, volume) {
            v.set_property("volume", valor);
        }
        pipeline.set_state(gst::State::Paused).map_err(|e| e.to_string())?;
        // Espera o preroll para o seek pegar; sem isso o vídeo começa do zero.
        let _ = pipeline.state(gst::ClockTime::from_seconds(8));
        // Transmissão ao vivo não tem posição para onde pular: seek em HLS de
        // live trava o pipeline em vez de adiantar.
        let ao_vivo = video.contains(".m3u8") || video.contains("/manifest/");
        if inicio_s > 0 && !ao_vivo {
            let _ = pipeline.seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT, gst::ClockTime::from_seconds(inicio_s));
        }
        pipeline.set_state(gst::State::Playing).map_err(|e| e.to_string())?;
        Ok(Player { pipeline, quadro, volume: vol })
    }

    pub fn quadro(&self) -> Option<Quadro> {
        self.quadro.lock().ok().and_then(|mut g| g.take())
    }

    pub fn pausar(&self, pausado: bool) {
        let alvo = if pausado { gst::State::Paused } else { gst::State::Playing };
        if let Err(e) = self.pipeline.set_state(alvo) {
            tracing::warn!("video: pausa: {e}");
        }
    }

    pub fn volume(&self, v: f64) {
        if let Some(e) = &self.volume {
            e.set_property("volume", v);
        }
    }

    pub fn acabou(&self) -> bool {
        let Some(bus) = self.pipeline.bus() else { return false };
        while let Some(msg) = bus.pop() {
            match msg.view() {
                gst::MessageView::Eos(_) => return true,
                gst::MessageView::Error(e) => {
                    tracing::warn!("video: gstreamer: {}", e.error());
                    return true;
                }
                _ => {}
            }
        }
        false
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}
