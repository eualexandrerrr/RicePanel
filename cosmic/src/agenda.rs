// Agenda: compromissos do Google Calendar pelo endereço secreto iCal.
//
// iCal e não a API oficial pelo mesmo motivo do painel antigo: OAuth exige
// consentimento em navegador e token que expira; a URL secreta é uma linha só,
// de leitura, que o Google renova apenas se o Alexandre pedir. A URL mora no
// cosmic-config do painel. O último retrato bom fica em cache: rede caída
// mostra a agenda de ontem com a hora em que foi lida, em vez de placa vazia.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

pub const JANELA_DIAS: i64 = 45;
pub const MAX_EVENTOS: usize = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evento {
    pub titulo: String,
    pub local: String,
    pub inicio: DateTime<Local>,
    pub fim: Option<DateTime<Local>>,
    pub dia_inteiro: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Agenda {
    pub eventos: Vec<Evento>,
    pub erro: Option<String>,
    pub atualizado_em: Option<DateTime<Local>>,
    #[serde(skip)]
    pub tem_url: bool,
}

impl Agenda {
    pub fn dias_com_evento(&self) -> HashSet<NaiveDate> {
        self.eventos.iter().map(|e| e.inicio.date_naive()).collect()
    }
}

fn arquivo_cache() -> PathBuf {
    crate::vidro::dir_cache().join("agenda.json")
}

pub fn ler_cache() -> Agenda {
    std::fs::read_to_string(arquivo_cache())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn grava_cache(a: &Agenda) {
    let _ = std::fs::create_dir_all(crate::vidro::dir_cache());
    if let Ok(s) = serde_json::to_string(a) {
        let _ = std::fs::write(arquivo_cache(), s);
    }
}

// ------------------------------------------------------------- o ICS

// Linha dobrada (CRLF + espaço) volta a ser uma. RFC 5545 §3.1.
fn desdobra(texto: &str) -> String {
    texto.replace("\r\n ", "").replace("\r\n\t", "").replace("\n ", "").replace("\n\t", "")
}

fn desescapa(v: &str) -> String {
    v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace(r"\;", ";").replace("\\\\", "\\")
}

struct Linha<'a> {
    nome: &'a str,
    params: Vec<(&'a str, &'a str)>,
    valor: &'a str,
}

fn separa_linha(l: &str) -> Option<Linha<'_>> {
    // O `:` que separa nome de valor é o primeiro fora de aspas.
    let mut aspas = false;
    let mut corte = None;
    for (i, c) in l.char_indices() {
        match c {
            '"' => aspas = !aspas,
            ':' if !aspas => {
                corte = Some(i);
                break;
            }
            _ => {}
        }
    }
    let corte = corte?;
    let (cabeca, valor) = (&l[..corte], &l[corte + 1..]);
    let mut partes = cabeca.split(';');
    let nome = partes.next()?;
    let params = partes.filter_map(|p| p.split_once('=')).collect();
    Some(Linha { nome, params, valor })
}

fn fuso_local_nome() -> String {
    std::fs::read_link("/etc/localtime")
        .ok()
        .and_then(|p| {
            let s = p.to_string_lossy().into_owned();
            s.split("zoneinfo/").nth(1).map(|z| z.to_string())
        })
        .unwrap_or_else(|| "UTC".into())
}

#[derive(Debug, Clone)]
struct Data {
    quando: DateTime<Local>,
    dia_inteiro: bool,
}

fn le_data(valor: &str, params: &[(&str, &str)]) -> Option<Data> {
    let valor = valor.trim();
    let tzid = params.iter().find(|(k, _)| k.eq_ignore_ascii_case("TZID")).map(|(_, v)| *v);
    let so_data = params.iter().any(|(k, v)| k.eq_ignore_ascii_case("VALUE") && v.eq_ignore_ascii_case("DATE"))
        || valor.len() == 8;
    if so_data {
        let d = NaiveDate::parse_from_str(&valor[..8], "%Y%m%d").ok()?;
        let dt = Local.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).single()?;
        return Some(Data { quando: dt, dia_inteiro: true });
    }
    let utc = valor.ends_with('Z');
    let bruto = valor.trim_end_matches('Z');
    let naive = NaiveDateTime::parse_from_str(bruto, "%Y%m%dT%H%M%S").ok()?;
    let quando = if utc {
        Utc.from_utc_datetime(&naive).with_timezone(&Local)
    } else if let Some(tz) = tzid.and_then(|t| t.trim_matches('"').parse::<chrono_tz::Tz>().ok()) {
        tz.from_local_datetime(&naive).single()?.with_timezone(&Local)
    } else {
        Local.from_local_datetime(&naive).single()?
    };
    Some(Data { quando, dia_inteiro: false })
}

#[derive(Default)]
struct Bruto {
    inicio: Option<Data>,
    fim: Option<Data>,
    titulo: String,
    local: String,
    rrule: Option<String>,
    exdatas: Vec<DateTime<Local>>,
    cancelado: bool,
}

fn expande(ev: &Bruto, de: DateTime<Local>, ate: DateTime<Local>, saida: &mut Vec<Evento>) {
    let Some(ini) = &ev.inicio else { return };
    if ev.cancelado {
        return;
    }
    let base = |quando: DateTime<Local>, fim: Option<DateTime<Local>>| Evento {
        titulo: if ev.titulo.is_empty() { "(sem título)".into() } else { ev.titulo.clone() },
        local: ev.local.clone(),
        inicio: quando,
        fim,
        dia_inteiro: ini.dia_inteiro,
    };
    let duracao = ev.fim.as_ref().map(|f| f.quando - ini.quando);

    if let Some(regra) = &ev.rrule {
        // O crate `rrule` lê o mesmo texto do ICS: DTSTART com fuso, RRULE e EXDATE.
        let fuso = fuso_local_nome();
        let mut texto = format!("DTSTART;TZID={fuso}:{}\nRRULE:{regra}\n", ini.quando.format("%Y%m%dT%H%M%S"));
        for ex in &ev.exdatas {
            texto.push_str(&format!("EXDATE;TZID={fuso}:{}\n", ex.format("%Y%m%dT%H%M%S")));
        }
        match texto.parse::<rrule::RRuleSet>() {
            Ok(conjunto) => {
                let datas = conjunto
                    .after(de.with_timezone(&rrule::Tz::UTC))
                    .before(ate.with_timezone(&rrule::Tz::UTC))
                    .all(200)
                    .dates;
                for d in datas {
                    let quando = d.with_timezone(&Local);
                    saida.push(base(quando, duracao.map(|du| quando + du)));
                }
            }
            Err(e) => tracing::debug!("rrule ignorada ({e}): {regra}"),
        }
        return;
    }
    if ini.quando < de || ini.quando > ate {
        return;
    }
    saida.push(base(ini.quando, ev.fim.as_ref().map(|f| f.quando)));
}

pub fn le_ics(texto: &str, agora: DateTime<Local>) -> Vec<Evento> {
    let de = agora - chrono::Duration::hours(12);
    let ate = agora + chrono::Duration::days(JANELA_DIAS);
    let mut eventos = Vec::new();
    let mut atual: Option<Bruto> = None;
    for linha in desdobra(texto).lines() {
        let t = linha.trim_end_matches('\r');
        match t {
            "BEGIN:VEVENT" => atual = Some(Bruto::default()),
            "END:VEVENT" => {
                if let Some(ev) = atual.take() {
                    expande(&ev, de, ate, &mut eventos);
                }
            }
            _ => {
                let Some(ev) = atual.as_mut() else { continue };
                let Some(p) = separa_linha(t) else { continue };
                match p.nome.to_ascii_uppercase().as_str() {
                    "DTSTART" => ev.inicio = le_data(p.valor, &p.params),
                    "DTEND" => ev.fim = le_data(p.valor, &p.params),
                    "SUMMARY" => ev.titulo = desescapa(p.valor),
                    "LOCATION" => ev.local = desescapa(p.valor),
                    "RRULE" => ev.rrule = Some(p.valor.to_string()),
                    "STATUS" => ev.cancelado = p.valor.trim().eq_ignore_ascii_case("CANCELLED"),
                    "EXDATE" => {
                        for v in p.valor.split(',') {
                            if let Some(d) = le_data(v, &p.params) {
                                ev.exdatas.push(d.quando);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    eventos.sort_by_key(|e| e.inicio);
    eventos.truncate(MAX_EVENTOS);
    eventos
}

// ----------------------------------------------------------- a busca

pub async fn buscar(url: String, anterior: Agenda) -> Agenda {
    let mut estado = anterior;
    estado.tem_url = !url.trim().is_empty();
    if !estado.tem_url {
        estado.erro = None;
        return estado;
    }
    let cliente = reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("RicePanel/2.0").build();
    let resposta: Result<String, String> = async {
        let r = cliente.map_err(|e| e.to_string())?.get(url.trim()).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("HTTP {}", r.status().as_u16()));
        }
        let texto = r.text().await.map_err(|e| e.to_string())?;
        if !texto.contains("BEGIN:VCALENDAR") {
            return Err("a resposta não é um calendário iCal".into());
        }
        Ok(texto)
    }
    .await;
    match resposta {
        Ok(texto) => {
            estado.eventos = le_ics(&texto, Local::now());
            estado.atualizado_em = Some(Local::now());
            estado.erro = None;
            grava_cache(&estado);
            tracing::info!("agenda: {} compromisso(s) na janela de {JANELA_DIAS} dias", estado.eventos.len());
        }
        Err(e) => {
            // Erro não apaga o que está na tela: o cache continua valendo.
            tracing::warn!("agenda: {e}");
            estado.erro = Some(e);
        }
    }
    estado
}
