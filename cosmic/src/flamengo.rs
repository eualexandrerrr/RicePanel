// Próximo jogo do Flamengo, pela API pública de placar do ESPN (time 819).
// Sem chave, sem cota publicada. A agenda é por competição, então perguntamos
// as quatro que interessam e ficamos com o jogo mais próximo entre elas.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};

const TIME: &str = "819";
const COMPETICOES: [(&str, &str); 4] = [
    ("bra.1", "Brasileirão"),
    ("bra.camp.carioca", "Carioca"),
    ("conmebol.libertadores", "Libertadores"),
    ("bra.copa_do_brazil", "Copa do Brasil"),
];
const PRAZO: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Lado {
    pub id: String,
    pub nome: String,
    pub sigla: String,
    pub escudo: String,
    pub escudo_local: Option<PathBuf>,
    pub placar: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Jogo {
    pub id: String,
    pub quando: DateTime<Local>,
    pub competicao: String,
    pub estado: String, // pre | in | post
    pub casa: Lado,
    pub fora: Lado,
    pub local: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Estado {
    pub jogo: Option<Jogo>,
    pub erro: Option<String>,
    pub atualizado_em: Option<DateTime<Local>>,
}

fn arquivo_cache() -> PathBuf {
    crate::vidro::dir_cache().join("flamengo.json")
}

pub fn ler_cache() -> Estado {
    std::fs::read_to_string(arquivo_cache())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn grava_cache(e: &Estado) {
    let _ = std::fs::create_dir_all(crate::vidro::dir_cache());
    if let Ok(s) = serde_json::to_string(e) {
        let _ = std::fs::write(arquivo_cache(), s);
    }
}

fn lado(c: &serde_json::Value) -> Lado {
    let t = &c["team"];
    let texto = |v: &serde_json::Value| v.as_str().unwrap_or("").to_string();
    Lado {
        id: texto(&t["id"]),
        nome: [&t["shortDisplayName"], &t["displayName"], &t["name"]]
            .iter()
            .map(|v| texto(v))
            .find(|s| !s.is_empty())
            .unwrap_or_default(),
        sigla: texto(&t["abbreviation"]),
        escudo: t["logos"][0]["href"].as_str().or(t["logo"].as_str()).unwrap_or("").to_string(),
        escudo_local: None,
        placar: c["score"].as_str().and_then(|s| s.parse().ok()).or_else(|| c["score"].as_i64().map(|v| v as i32)),
    }
}

fn converte(ev: &serde_json::Value, competicao: &str) -> Option<Jogo> {
    let comp = ev["competitions"].get(0)?;
    let times = comp["competitors"].as_array()?;
    let casa = times.iter().find(|c| c["homeAway"] == "home")?;
    let fora = times.iter().find(|c| c["homeAway"] == "away")?;
    let quando = DateTime::parse_from_rfc3339(ev["date"].as_str()?)
        .ok()
        .map(|d| d.with_timezone(&Local))
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(ev["date"].as_str()?, "%Y-%m-%dT%H:%MZ")
                .ok()
                .map(|n| Utc.from_utc_datetime(&n).with_timezone(&Local))
        })?;
    Some(Jogo {
        id: ev["id"].as_str().unwrap_or("").to_string(),
        quando,
        competicao: competicao.to_string(),
        estado: comp["status"]["type"]["state"].as_str().unwrap_or("pre").to_string(),
        casa: lado(casa),
        fora: lado(fora),
        local: comp["venue"]["fullName"].as_str().unwrap_or("").to_string(),
    })
}

use chrono::TimeZone;

async fn da_competicao(cliente: &reqwest::Client, slug: &str, nome: &str) -> Vec<Jogo> {
    let url = format!("https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams/{TIME}/schedule?fixture=true");
    let r = match cliente.get(&url).header("accept", "application/json").send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("flamengo: {slug}: {e}");
            return vec![];
        }
    };
    let v = match r.json::<serde_json::Value>().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("flamengo: {slug}: json: {e}");
            return vec![];
        }
    };
    v["events"]
        .as_array()
        .map(|evs| evs.iter().filter_map(|e| converte(e, nome)).collect())
        .unwrap_or_default()
}

// O que está rolando; senão o próximo; senão o que acabou há menos de três horas.
fn escolhe(jogos: Vec<Jogo>) -> Option<Jogo> {
    let agora = Local::now();
    if let Some(v) = jogos.iter().find(|j| j.estado == "in") {
        return Some(v.clone());
    }
    let mut futuros: Vec<&Jogo> = jogos
        .iter()
        .filter(|j| j.estado == "pre" && j.quando > agora - chrono::Duration::hours(2))
        .collect();
    futuros.sort_by_key(|j| j.quando);
    if let Some(f) = futuros.first() {
        return Some((*f).clone());
    }
    let mut recentes: Vec<&Jogo> = jogos
        .iter()
        .filter(|j| j.estado == "post" && agora - j.quando < chrono::Duration::hours(3))
        .collect();
    recentes.sort_by_key(|j| std::cmp::Reverse(j.quando));
    recentes.first().map(|j| (*j).clone())
}

// O escudo é baixado uma vez e vive no disco: no boot o painel sobe antes da
// rede, e imagem remota que falha nunca é pedida de novo.
async fn guarda_escudo(cliente: &reqwest::Client, url: &str, id: &str) -> Option<PathBuf> {
    if url.is_empty() || id.is_empty() {
        return None;
    }
    let pasta = crate::vidro::dir_cache().join("escudos");
    let _ = std::fs::create_dir_all(&pasta);
    let ext = url.rsplit('.').next().and_then(|e| e.split('?').next()).unwrap_or("png").to_ascii_lowercase();
    let ext = if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") { ext } else { "png".into() };
    let destino = pasta.join(format!("{id}.{ext}"));
    if std::fs::metadata(&destino).map(|m| m.len() > 0).unwrap_or(false) {
        return Some(destino);
    }
    let bytes = cliente.get(url).send().await.ok()?.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    std::fs::write(&destino, &bytes).ok()?;
    Some(destino)
}

pub async fn buscar(anterior: Estado) -> Estado {
    let mut estado = anterior;
    let Ok(cliente) = reqwest::Client::builder().timeout(PRAZO).user_agent("RicePanel/2.0 (+https://github.com/eualexandrerrr/RicePanel)").build() else { return estado };
    let mut jogos = Vec::new();
    for (slug, nome) in COMPETICOES {
        jogos.extend(da_competicao(&cliente, slug, nome).await);
    }
    if jogos.is_empty() {
        estado.erro = Some("sem resposta do ESPN".into());
        tracing::warn!("flamengo: nenhuma competição respondeu; fica o cache");
        return estado;
    }
    let mut escolhido = escolhe(jogos);
    if let Some(j) = escolhido.as_mut() {
        j.casa.escudo_local = guarda_escudo(&cliente, &j.casa.escudo, &j.casa.id).await;
        j.fora.escudo_local = guarda_escudo(&cliente, &j.fora.escudo, &j.fora.id).await;
        tracing::info!("flamengo: {} x {} ({}, {})", j.casa.nome, j.fora.nome, j.competicao, j.quando);
    }
    estado = Estado { jogo: escolhido, erro: None, atualizado_em: Some(Local::now()) };
    grava_cache(&estado);
    estado
}

pub fn intervalo(e: &Estado) -> Duration {
    if e.jogo.as_ref().map(|j| j.estado == "in").unwrap_or(false) {
        Duration::from_secs(60)
    } else {
        Duration::from_secs(600)
    }
}
