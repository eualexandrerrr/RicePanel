// Música: o que está tocando, pelo MPRIS via `playerctl`.
//
// O `playerctl` já resolve a escolha de player e os comandos; um cliente zbus
// próprio seria mais código para o mesmo resultado. Cadência de 2 s, como o
// retrato da máquina.

use std::time::Duration;

use crate::sistema::roda;

#[derive(Debug, Clone, PartialEq)]
pub struct Musica {
    pub tocando: bool,
    pub artista: String,
    pub titulo: String,
    pub duracao: Option<u64>,
    pub posicao: Option<u64>,
    pub player: String,
}

const SEP: &str = "\u{1f}";

pub async fn atual() -> Option<Musica> {
    let formato = ["{{status}}", "{{artist}}", "{{title}}", "{{mpris:length}}", "{{position}}", "{{playerName}}"].join(SEP);
    let out = roda("playerctl", &["metadata", "--format", &formato], Duration::from_millis(1500)).await;
    let p: Vec<&str> = out.trim().split(SEP).collect();
    if p.len() < 3 || p[2].is_empty() {
        return None;
    }
    let micros = |s: &str| s.trim().parse::<f64>().ok().filter(|v| *v > 0.0).map(|v| (v / 1e6).round() as u64);
    Some(Musica {
        tocando: p[0].to_ascii_lowercase().contains("playing"),
        artista: p.get(1).unwrap_or(&"").to_string(),
        titulo: p[2].to_string(),
        duracao: p.get(3).and_then(|s| micros(s)),
        posicao: p.get(4).and_then(|s| micros(s)),
        player: p.get(5).unwrap_or(&"").to_string(),
    })
}

pub fn eh_spotify(m: &Musica) -> bool {
    m.player.to_ascii_lowercase().contains("spotify")
}

pub async fn comando(verbo: &'static str, player: String) {
    let acao = match verbo {
        "anterior" => "previous",
        "proximo" => "next",
        _ => "play-pause",
    };
    if player.is_empty() {
        roda("playerctl", &[acao], Duration::from_millis(2500)).await;
    } else {
        roda("playerctl", &["-p", &player, acao], Duration::from_millis(2500)).await;
    }
}
