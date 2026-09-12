// A hora: a leitura de mais longe. LUZ sobre GAZE, sem recipiente.
// Medidas do CSS do painel antigo (`.m-hora`, `.m-relogio`, `.m-meta`).

use std::sync::Arc;

use chrono::{Datelike, Timelike};
use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::widget::text::LineHeight;
use cosmic::iced::{Alignment, Color, Length};
use cosmic::theme;
use cosmic::widget::{Column, Row, container, text};
use image::RgbaImage;

use super::{Message, Mirante};
use crate::placa::placa;
use crate::tema;

const DIAS: [&str; 7] = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];
const MESES: [&str; 12] = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

pub fn saudacao(h: u32) -> &'static str {
    match h {
        0..=4 => "Madrugada",
        5..=11 => "Bom dia",
        12..=17 => "Boa tarde",
        _ => "Boa noite",
    }
}

pub fn data_longa(d: &chrono::DateTime<chrono::Local>) -> String {
    format!("{}, {} de {}", DIAS[d.weekday().num_days_from_monday() as usize], d.day(), MESES[d.month0() as usize])
}

// `.rotulo`: Archivo Narrow 11,5px 700, caixa alta, tracking 0,2em, subtext0.
pub fn rotulo<'a>(s: &str) -> cosmic::iced::widget::Text<'a, cosmic::Theme, cosmic::Renderer> {
    text(tema::tracado(s))
        .size(11.5)
        .font(tema::narrow(Weight::Bold))
        .class(theme::Text::Color(tema::SERIGRAFIA))
}

pub fn uptime() -> String {
    let s = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let seg = s.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u64;
    let (d, h, m) = (seg / 86400, (seg % 86400) / 3600, (seg % 3600) / 60);
    if d > 0 { format!("{d}d {h}h") } else { format!("{h}h {m:02}m") }
}

fn meta<'a>(nome: &str, valor: String) -> Element<'a, Message> {
    Row::new()
        .push(rotulo(nome))
        .push(text(valor).size(15).font(tema::archivo(Weight::Normal)).class(theme::Text::Color(tema::LEITURA)))
        .spacing(8)
        .align_y(Alignment::End)
        .into()
}

pub fn view<'a>(m: &'a Mirante, vidro: Option<Arc<RgbaImage>>) -> Element<'a, Message> {
    let agora = &m.agora;
    let pontos = Color { a: if m.pontos_acesos { 1.0 } else { 0.22 }, ..tema::ACENTO };
    let digito = |s: String, cor: Color| {
        text(s)
            .size(96)
            .font(tema::archivo(Weight::ExtraLight))
            .line_height(LineHeight::Relative(0.9))
            .class(theme::Text::Color(cor))
    };
    let relogio = Row::new()
        .push(digito(format!("{:02}", agora.hour()), tema::LEITURA))
        .push(digito(":".into(), pontos))
        .push(digito(format!("{:02}", agora.minute()), tema::LEITURA))
        .align_y(Alignment::Center);

    let ano_fim = chrono::NaiveDate::from_ymd_opt(agora.year(), 12, 31).map(|d| d.ordinal()).unwrap_or(365);
    let linha = container(
        Row::new()
            .push(meta("Semana", format!("S{}", agora.iso_week().week())))
            .push(meta("Dia", format!("{}/{}", agora.ordinal(), ano_fim)))
            .push(meta("Uptime", uptime()))
            .spacing(24),
    )
    .padding([10, 0, 0, 0])
    .class(theme::Container::Custom(Box::new(|_| cosmic::iced::widget::container::Style {
        border: cosmic::iced::Border { width: 0.0, ..Default::default() },
        ..Default::default()
    })));
    // O filete: a única régua da página, e ela mora aqui.
    let filete = crate::widgets::trilho::trilho(0.0, Color::TRANSPARENT).altura(1.0).width(Length::Fixed(520.0));
    let _ = filete;

    let bloco = Column::new()
        .push(
            text(tema::tracado(saudacao(agora.hour())))
                .size(10)
                .font(tema::narrow(Weight::Bold))
                .class(theme::Text::Color(tema::LAVENDER)),
        )
        .push(relogio)
        .push(
            text(tema::tracado(&data_longa(agora)))
                .size(11)
                .font(tema::narrow(Weight::Bold))
                .class(theme::Text::Color(tema::SUBTEXT1)),
        )
        .push(regua())
        .push(linha)
        .spacing(6)
        .align_x(Alignment::Center)
        .width(Length::Fill);

    placa(vidro, bloco).gaze().padding([22, 30]).into()
}

// Linha de 1px, largura de 520: separa a data da linha de meta.
fn regua<'a>() -> Element<'a, Message> {
    container(cosmic::widget::Space::new().width(Length::Fixed(520.0)).height(Length::Fixed(1.0)))
        .class(theme::Container::Custom(Box::new(|_| cosmic::iced::widget::container::Style {
            background: Some(cosmic::iced::Background::Color(Color { a: 0.13, ..tema::TEXT })),
            ..Default::default()
        })))
        .padding([8, 0, 0, 0])
        .into()
}
