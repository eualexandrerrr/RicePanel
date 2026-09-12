// O vidro: o papel de parede do monitor em pé, desfocado uma vez e guardado.
//
// Cada placa mostra o pedaço desfocado que está exatamente atrás dela — é
// `backdrop-filter` de verdade, só que calculado fora do compositor. A imagem
// vem da config do cosmic-bg (`com.system76.CosmicBackground`), o mesmo lugar
// que o menu de papel de parede escreve, então trocar lá troca aqui.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::RgbaImage;

pub const SIGMA: f32 = 34.0;

#[derive(Debug)]
pub struct Vidro {
    pub origem: PathBuf,
    pub largura: u32,
    pub altura: u32,
    pub borrado: Arc<RgbaImage>,
}

fn config_bg() -> PathBuf {
    dirs_config().join("cosmic/com.system76.CosmicBackground/v1")
}

fn dirs_config() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"))
}

pub fn dir_cache() -> PathBuf {
    std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".cache"))
        .join("ricepanel")
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

// O RON do cosmic-bg tem `source: Path("...")` ou `source: Color(...)`. Só o
// caminho interessa; um parser de RON inteiro para ler um campo é peso à toa.
fn caminho_no_ron(texto: &str) -> Option<PathBuf> {
    let i = texto.find("Path(\"")? + 6;
    let fim = texto[i..].find('"')? + i;
    Some(PathBuf::from(&texto[i..fim]))
}

pub fn caminho_wallpaper(saida: &str) -> Option<PathBuf> {
    let base = config_bg();
    let mesmo_em_todas = std::fs::read_to_string(base.join("same-on-all"))
        .map(|s| s.trim() == "true")
        .unwrap_or(true);
    let arquivo = if mesmo_em_todas {
        base.join("all")
    } else {
        let por_saida = base.join(format!("output.{saida}"));
        if por_saida.exists() { por_saida } else { base.join("all") }
    };
    let texto = std::fs::read_to_string(&arquivo).ok()?;
    let caminho = caminho_no_ron(&texto)?;
    if caminho.is_dir() {
        // Pasta em rotação: a primeira imagem serve; o cosmic-bg escolhe outra
        // a cada tantos minutos e a varredura pega depois.
        let mut nomes: Vec<PathBuf> = std::fs::read_dir(&caminho)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| eh_imagem(p))
            .collect();
        nomes.sort();
        return nomes.into_iter().next();
    }
    Some(caminho)
}

fn eh_imagem(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("jpg" | "jpeg" | "png" | "webp")
    )
}

fn chave_cache(origem: &Path, w: u32, h: u32) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    origem.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(origem) {
        meta.len().hash(&mut hasher);
        if let Ok(m) = meta.modified() {
            m.hash(&mut hasher);
        }
    }
    (w, h, SIGMA.to_bits()).hash(&mut hasher);
    format!("vidro-{:016x}.png", hasher.finish())
}

// Mesmo recorte do modo Zoom do cosmic-bg: cobre o monitor e corta o que sobra,
// centrado. Assim o pedaço desfocado casa com o pedaço nítido atrás da placa.
fn cobrir(img: image::DynamicImage, w: u32, h: u32) -> RgbaImage {
    let (iw, ih) = (img.width() as f32, img.height() as f32);
    let escala = (w as f32 / iw).max(h as f32 / ih);
    let (nw, nh) = ((iw * escala).ceil() as u32, (ih * escala).ceil() as u32);
    let redim = img.resize_exact(nw.max(w), nh.max(h), image::imageops::FilterType::Triangle);
    let x = (redim.width() - w) / 2;
    let y = (redim.height() - h) / 2;
    redim.crop_imm(x, y, w, h).to_rgba8()
}

pub fn preparar_sync(saida: &str, w: u32, h: u32) -> Result<Vidro, String> {
    let origem = caminho_wallpaper(saida).ok_or("cosmic-bg sem papel de parede")?;
    let cache = dir_cache();
    let _ = std::fs::create_dir_all(&cache);
    let arquivo = cache.join(chave_cache(&origem, w, h));
    if let Ok(pronto) = image::open(&arquivo) {
        let rgba = pronto.to_rgba8();
        if rgba.width() == w && rgba.height() == h {
            return Ok(Vidro { origem, largura: w, altura: h, borrado: Arc::new(rgba) });
        }
    }
    let inicio = std::time::Instant::now();
    let img = image::open(&origem).map_err(|e| format!("{}: {e}", origem.display()))?;
    let cortada = cobrir(img, w, h);
    let borrado = image::imageops::fast_blur(&cortada, SIGMA);
    if let Err(e) = borrado.save(&arquivo) {
        tracing::warn!("vidro: não guardou o cache: {e}");
    }
    tracing::info!(
        "vidro: {} desfocado em {} ms",
        origem.display(),
        inicio.elapsed().as_millis()
    );
    Ok(Vidro { origem, largura: w, altura: h, borrado: Arc::new(borrado) })
}

pub async fn preparar(saida: String, w: u32, h: u32) -> Result<Arc<Vidro>, String> {
    tokio::task::spawn_blocking(move || preparar_sync(&saida, w, h))
        .await
        .map_err(|e| e.to_string())?
        .map(Arc::new)
}
