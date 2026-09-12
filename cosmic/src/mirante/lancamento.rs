// Contagem regressiva do GTA VI. Dias, horas e minutos; sem segundos de
// propósito: dígito girando no canto do olho o dia todo é movimento à toa.

use chrono::{Local, TimeZone};
use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Length};
use cosmic::widget::{Column, Row, container};

use super::ui;
use super::Message;
use crate::tema;

fn celula<'a>(v: String, rot: &str) -> Element<'a, Message> {
    container(
        Column::new()
            .push(ui::texto(v, 27.0, Weight::ExtraBold, tema::LEITURA))
            .push(ui::narrow(tema::tracado(rot), 9.5, Weight::Bold, tema::SERIGRAFIA_FRACA))
            .spacing(5)
            .align_x(Alignment::Center),
    )
    .padding([0, 13])
    .into()
}

pub fn view<'a>() -> Element<'a, Message> {
    let alvo = Local.with_ymd_and_hms(2026, 11, 19, 0, 0, 0).unwrap();
    let agora = Local::now();
    let ident = Column::new()
        .push(ui::narrow(tema::tracado("Grand Theft Auto VI"), 12.0, Weight::Bold, tema::LEITURA))
        .push(ui::narrow("Quinta, 19 de novembro de 2026", 12.5, Weight::Semibold, tema::SERIGRAFIA))
        .push(ui::rotulo("PS5 · Xbox Series X|S"))
        .spacing(6);
    let conta: Element<'a, Message> = if alvo <= agora {
        let hoje = alvo.date_naive() == agora.date_naive();
        celula(if hoje { "É hoje".into() } else { "Lançado".into() }, "19 nov 2026")
    } else {
        let t = (alvo - agora).num_seconds();
        let (d, h, m) = (t / 86400, (t % 86400) / 3600, (t % 3600) / 60);
        Row::new()
            .push(celula(d.to_string(), if d == 1 { "dia" } else { "dias" }))
            .push(celula(h.to_string(), if h == 1 { "hora" } else { "horas" }))
            .push(celula(m.to_string(), "min"))
            .into()
    };
    container(
        Row::new()
            .push(ui::texto("VI", 30.0, Weight::ExtraBold, tema::PEACH))
            .push(ident)
            .push(conta)
            .spacing(18)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .center_x(Length::Fill)
    .into()
}
