// O volume do player do YouTube, como está no Chrome dele.
//
// O controle de volume do YouTube não mexe no fluxo do PipeWire nem no MPRIS
// (os dois dizem 100%): ele baixa o som dentro da página e grava o valor no
// Local Storage, chave `yt-player-volume`, JSON `{"volume":4,"muted":false}`.
// O Local Storage é LevelDB: o arquivo `.log` guarda as escritas recentes sem
// compressão e as tabelas `.ldb` guardam o resto em blocos snappy. Lemos uma
// cópia (o original fica travado com o Chrome de pé) e ficamos com a escrita de
// maior número de sequência.

use std::path::{Path, PathBuf};

const CHAVE: &[u8] = b"yt-player-volume";

fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let (mut r, mut s) = (0u64, 0u32);
    loop {
        let c = *b.get(*i)?;
        *i += 1;
        r |= ((c & 0x7f) as u64) << s;
        if c < 0x80 {
            return Some(r);
        }
        s += 7;
        if s > 63 {
            return None;
        }
    }
}

fn snappy(b: &[u8]) -> Option<Vec<u8>> {
    let mut i = 0;
    let tam = varint(b, &mut i)? as usize;
    let mut out = Vec::with_capacity(tam);
    while i < b.len() {
        let t = b[i];
        match t & 3 {
            0 => {
                let mut ln = (t >> 2) as usize;
                if ln >= 60 {
                    let nb = ln - 59;
                    ln = b.get(i + 1..i + 1 + nb)?.iter().rev().fold(0usize, |a, &x| (a << 8) | x as usize);
                    i += nb;
                }
                i += 1;
                ln += 1;
                out.extend_from_slice(b.get(i..i + ln)?);
                i += ln;
            }
            k => {
                let (ln, off, passo) = match k {
                    1 => (((t >> 2) & 7) as usize + 4, (((t >> 5) as usize) << 8) | *b.get(i + 1)? as usize, 2),
                    2 => ((t >> 2) as usize + 1, u16::from_le_bytes([*b.get(i + 1)?, *b.get(i + 2)?]) as usize, 3),
                    _ => ((t >> 2) as usize + 1, u32::from_le_bytes(b.get(i + 1..i + 5)?.try_into().ok()?) as usize, 5),
                };
                i += passo;
                if off == 0 || off > out.len() {
                    return None;
                }
                for _ in 0..ln {
                    let c = out[out.len() - off];
                    out.push(c);
                }
            }
        }
    }
    Some(out)
}

fn bloco(arq: &[u8], off: usize, tam: usize) -> Option<Vec<u8>> {
    let dados = arq.get(off..off + tam)?;
    match *arq.get(off + tam)? {
        1 => snappy(dados),
        _ => Some(dados.to_vec()),
    }
}

fn entradas(b: &[u8]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut saida = Vec::new();
    if b.len() < 4 {
        return saida;
    }
    let restarts = u32::from_le_bytes(b[b.len() - 4..].try_into().unwrap()) as usize;
    let fim = b.len().saturating_sub(4 + 4 * restarts);
    let (mut i, mut chave) = (0usize, Vec::new());
    while i < fim {
        let (Some(comp), Some(nao), Some(vl)) = (varint(b, &mut i), varint(b, &mut i), varint(b, &mut i)) else { break };
        let (comp, nao, vl) = (comp as usize, nao as usize, vl as usize);
        let Some(pedaco) = b.get(i..i + nao) else { break };
        chave.truncate(comp);
        chave.extend_from_slice(pedaco);
        i += nao;
        let Some(valor) = b.get(i..i + vl) else { break };
        saida.push((chave.clone(), valor.to_vec()));
        i += vl;
    }
    saida
}

// Tabela `.ldb`: rodapé de 48 bytes -> bloco de índice -> blocos de dados.
fn da_tabela(arq: &[u8]) -> Option<(u64, Vec<u8>)> {
    let pe = arq.get(arq.len().checked_sub(48)?..)?;
    let mut i = 0;
    varint(pe, &mut i)?;
    varint(pe, &mut i)?;
    let (ioff, itam) = (varint(pe, &mut i)? as usize, varint(pe, &mut i)? as usize);
    let mut melhor: Option<(u64, Vec<u8>)> = None;
    for (_, h) in entradas(&bloco(arq, ioff, itam)?) {
        let mut j = 0;
        let (Some(off), Some(tam)) = (varint(&h, &mut j), varint(&h, &mut j)) else { continue };
        let Some(dados) = bloco(arq, off as usize, tam as usize) else { continue };
        for (k, v) in entradas(&dados) {
            if k.len() < 8 || !k.windows(CHAVE.len()).any(|w| w == CHAVE) || !k.windows(11).any(|w| w == b"youtube.com") {
                continue;
            }
            let seq = u64::from_le_bytes(k[k.len() - 8..].try_into().ok()?) >> 8;
            if melhor.as_ref().map(|(s, _)| seq > *s).unwrap_or(true) {
                melhor = Some((seq, v));
            }
        }
    }
    melhor
}

// `.log`: registros de WriteBatch sem compressão. Cada lote começa com a
// sequência (8 bytes) e a contagem (4); dentro, `1 | varint chave | varint valor`.
fn do_log(arq: &[u8]) -> Option<(u64, Vec<u8>)> {
    let mut melhor: Option<(u64, Vec<u8>)> = None;
    let mut pos = 0;
    while let Some(achou) = arq[pos..].windows(CHAVE.len()).position(|w| w == CHAVE) {
        let ini = pos + achou;
        pos = ini + CHAVE.len();
        let mut i = pos;
        let Some(vl) = varint(arq, &mut i) else { continue };
        let Some(valor) = arq.get(i..i + vl as usize) else { continue };
        // Ordem no arquivo é ordem de escrita: a última ocorrência vence.
        let seq = u64::MAX / 2 + ini as u64;
        melhor = Some((seq, valor.to_vec()));
    }
    melhor
}

fn numero_depois(texto: &str, campo: &str) -> Option<f64> {
    let i = texto.find(campo)? + campo.len();
    let resto = texto[i..].trim_start_matches(|c: char| c == '\\' || c == '"' || c == ':' || c == ' ');
    let fim = resto.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(resto.len());
    resto[..fim].parse().ok()
}

fn pasta() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let p = PathBuf::from(home).join(".config/google-chrome/Default/Local Storage/leveldb");
    p.exists().then_some(p)
}

/// Volume do YouTube de 0 a 1, já com o mudo aplicado. `None` sem Chrome ou sem
/// a chave gravada.
pub fn volume_youtube() -> Option<f64> {
    ler(&pasta()?)
}

fn ler(dir: &Path) -> Option<f64> {
    let mut melhor: Option<(u64, Vec<u8>)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
        if ext != "ldb" && ext != "log" {
            continue;
        }
        let Ok(bytes) = std::fs::read(&p) else { continue };
        let achado = if ext == "log" { do_log(&bytes) } else { da_tabela(&bytes) };
        if let Some((seq, v)) = achado {
            if melhor.as_ref().map(|(s, _)| seq > *s).unwrap_or(true) {
                melhor = Some((seq, v));
            }
        }
    }
    let texto = String::from_utf8_lossy(&melhor?.1).into_owned();
    let volume = numero_depois(&texto, "volume")?;
    let mudo = texto.contains("muted\\\":true") || texto.contains("\"muted\":true");
    Some(if mudo { 0.0 } else { (volume / 100.0).clamp(0.0, 1.0) })
}

#[cfg(test)]
mod testes {
    #[test]
    fn le_copia_do_local_storage() {
        let dir = std::env::var("RICEPANEL_LS_COPIA").unwrap_or_default();
        if dir.is_empty() {
            return;
        }
        let v = super::ler(std::path::Path::new(&dir));
        println!("volume = {v:?}");
        assert!(v.is_some());
    }
}
