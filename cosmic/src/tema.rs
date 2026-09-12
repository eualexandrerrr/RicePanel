// Catppuccin Mocha, a paleta oficial, com os mesmos nomes do resto do rice.
// O painel fala pelos papéis (`LEITURA`, `SERIGRAFIA`...), nunca pelo hex.

#![allow(dead_code)]

use cosmic::iced::Color;
use cosmic::iced::font::{Family, Weight};
use cosmic::font::Font;

const fn hex(v: u32) -> Color {
    Color::from_rgb8(((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8)
}

pub const CRUST: Color = hex(0x11111b);
pub const MANTLE: Color = hex(0x181825);
pub const BASE: Color = hex(0x1e1e2e);
pub const SURFACE0: Color = hex(0x313244);
pub const SURFACE1: Color = hex(0x45475a);
pub const SURFACE2: Color = hex(0x585b70);
pub const OVERLAY0: Color = hex(0x6c7086);
pub const OVERLAY1: Color = hex(0x7f849c);
pub const OVERLAY2: Color = hex(0x9399b2);
pub const SUBTEXT0: Color = hex(0xa6adc8);
pub const SUBTEXT1: Color = hex(0xbac2de);
pub const TEXT: Color = hex(0xcdd6f4);
pub const MAUVE: Color = hex(0xcba6f7);
pub const LAVENDER: Color = hex(0xb4befe);
pub const BLUE: Color = hex(0x89b4fa);
pub const SAPPHIRE: Color = hex(0x74c7ec);
pub const SKY: Color = hex(0x89dceb);
pub const TEAL: Color = hex(0x94e2d5);
pub const GREEN: Color = hex(0xa6e3a1);
pub const YELLOW: Color = hex(0xf9e2af);
pub const PEACH: Color = hex(0xfab387);
pub const MAROON: Color = hex(0xeba0ac);
pub const RED: Color = hex(0xf38ba8);
pub const PINK: Color = hex(0xf5c2e7);

// Papéis.
pub const LEITURA: Color = TEXT;
pub const SERIGRAFIA: Color = SUBTEXT0;
pub const SERIGRAFIA_FRACA: Color = OVERLAY1;
pub const ACENTO: Color = MAUVE;
pub const SOBRE_ACENTO: Color = CRUST;
pub const VERDE: Color = GREEN;
pub const AMBAR: Color = YELLOW;
pub const VERMELHO: Color = RED;

pub fn alfa(c: Color, a: f32) -> Color {
    Color { a, ..c }
}

// Vidro: tinta que vai por cima do wallpaper desfocado dentro de cada placa.
pub const VIDRO_TINTA: Color = Color { r: 24.0 / 255.0, g: 24.0 / 255.0, b: 37.0 / 255.0, a: 0.62 };
pub const VIDRO_ARESTA: Color = Color { r: 205.0 / 255.0, g: 214.0 / 255.0, b: 244.0 / 255.0, a: 0.14 };
pub const VIDRO_RAIO: f32 = 28.0;

// Fontes. Archivo é o corpo, Archivo Narrow o rótulo, JetBrains Mono o número
// que precisa alinhar. Os TTF das duas primeiras vão embutidos no binário.
// Instâncias estáticas: o cosmic-text casa peso por igualdade exata, então a
// variável de 100 a 900 não serve — cada peso pedido tem de existir como face.
pub const FONTES: [&[u8]; 13] = [
    include_bytes!("../fontes/archivo-200.ttf"),
    include_bytes!("../fontes/archivo-300.ttf"),
    include_bytes!("../fontes/archivo-400.ttf"),
    include_bytes!("../fontes/archivo-500.ttf"),
    include_bytes!("../fontes/archivo-600.ttf"),
    include_bytes!("../fontes/archivo-700.ttf"),
    include_bytes!("../fontes/archivo-800.ttf"),
    include_bytes!("../fontes/archivo-narrow-400.ttf"),
    include_bytes!("../fontes/archivo-narrow-500.ttf"),
    include_bytes!("../fontes/archivo-narrow-600.ttf"),
    include_bytes!("../fontes/archivo-narrow-700.ttf"),
    include_bytes!("../fontes/jetbrains-mono-600.ttf"),
    include_bytes!("../fontes/jetbrains-mono-700.ttf"),
];

// `font::load` do iced não surte efeito neste libcosmic (testado: a família
// carregada nunca é escolhida). O que funciona é o fontdb ler o diretório de
// fontes do usuário na criação do FontSystem — então os TTF embutidos vão para
// `~/.local/share/fonts/ricepanel/` antes de o app subir. Só grava o que falta.
pub fn instalar_fontes() {
    const NOMES: [&str; 13] = [
        "archivo-200.ttf", "archivo-300.ttf", "archivo-400.ttf", "archivo-500.ttf", "archivo-600.ttf",
        "archivo-700.ttf", "archivo-800.ttf", "archivo-narrow-400.ttf", "archivo-narrow-500.ttf",
        "archivo-narrow-600.ttf", "archivo-narrow-700.ttf", "jetbrains-mono-600.ttf", "jetbrains-mono-700.ttf",
    ];
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")))
        .map(|p| p.join("fonts/ricepanel"));
    let Some(base) = base else { return };
    if std::fs::create_dir_all(&base).is_err() {
        return;
    }
    for (nome, bytes) in NOMES.iter().zip(FONTES.iter()) {
        let alvo = base.join(nome);
        let igual = std::fs::metadata(&alvo).map(|m| m.len() == bytes.len() as u64).unwrap_or(false);
        if !igual {
            if let Err(e) = std::fs::write(&alvo, bytes) {
                tracing::warn!("fonte {nome}: {e}");
            }
        }
    }
}

// Tracking não existe no iced: um espaço-fio entre as letras faz o papel do
// `letter-spacing` dos rótulos em caixa alta.
pub fn tracado(s: &str) -> String {
    let mut saida = String::with_capacity(s.len() * 4);
    let maiusc: Vec<char> = s.to_uppercase().chars().collect();
    for (i, c) in maiusc.iter().enumerate() {
        saida.push(*c);
        if i + 1 < maiusc.len() {
            saida.push('\u{200A}');
        }
    }
    saida
}

pub const fn archivo(weight: Weight) -> Font {
    Font { family: Family::Name("Archivo"), weight, ..Font::DEFAULT }
}

pub const fn narrow(weight: Weight) -> Font {
    Font { family: Family::Name("Archivo Narrow"), weight, ..Font::DEFAULT }
}

pub const fn mono(weight: Weight) -> Font {
    Font { family: Family::Name("JetBrains Mono"), weight, ..Font::DEFAULT }
}

// Escalas fixas, as mesmas do painel antigo: térmica de 30 a 100 °C, carga de 0 a 100 %.
pub fn cor_termica(celsius: f32) -> Color {
    if celsius > 82.0 { VERMELHO } else if celsius > 65.0 { AMBAR } else { VERDE }
}

pub fn cor_carga(pct: f32) -> Color {
    if pct > 90.0 { VERMELHO } else if pct > 70.0 { AMBAR } else { ACENTO }
}
