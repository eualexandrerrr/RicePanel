// Próximo jogo do Flamengo: escudos, times, quando, placar quando há.

use chrono::{Datelike, Local};
use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, ContentFit, Length};
use cosmic::widget::{Column, Row, image};

use super::ui;
use super::{Message, Mirante};
use crate::flamengo::Lado;
use crate::tema;

const DIAS: [&str; 7] = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const MESES_CURTO: [&str; 12] = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

fn quando_do_jogo(d: &chrono::DateTime<Local>) -> String {
    let hoje = Local::now().date_naive();
    let dia = d.date_naive();
    let hora = d.format("%H:%M");
    if dia == hoje {
        format!("Hoje, {hora}")
    } else if dia == hoje + chrono::Duration::days(1) {
        format!("Amanhã, {hora}")
    } else {
        format!("{}, {} de {}, {hora}", DIAS[dia.weekday().num_days_from_monday() as usize], dia.day(), MESES_CURTO[dia.month0() as usize])
    }
}

fn escudo<'a>(t: &Lado) -> Element<'a, Message> {
    match &t.escudo_local {
        Some(p) => image(image::Handle::from_path(p))
            .width(Length::Fixed(42.0))
            .height(Length::Fixed(42.0))
            .content_fit(ContentFit::Contain)
            .into(),
        None => ui::narrow(tema::tracado(if t.sigla.is_empty() { "?" } else { &t.sigla }), 12.0, Weight::Bold, tema::SERIGRAFIA).into(),
    }
}

pub fn view<'a>(m: &'a Mirante) -> Option<Element<'a, Message>> {
    let j = m.jogo.jogo.as_ref()?;
    let rolando = j.estado == "in";
    let terminou = j.estado == "post";
    let linha_quando = if rolando {
        format!("AGORA · {}", j.competicao)
    } else if terminou {
        format!("Fim de jogo · {}", j.competicao)
    } else {
        format!("{} · {}", quando_do_jogo(&j.quando), j.competicao)
    };
    let mut ident = Column::new()
        .push(ui::texto(format!("{} × {}", j.casa.nome, j.fora.nome), 15.0, Weight::Normal, tema::LEITURA))
        .push(ui::narrow(linha_quando, 12.5, Weight::Semibold, if rolando { tema::VERDE } else { tema::SERIGRAFIA }))
        .spacing(5);
    if !j.local.is_empty() {
        ident = ident.push(ui::rotulo(&j.local));
    }
    let mut linha = Row::new()
        .push(
            Row::new()
                .push(escudo(&j.casa))
                .push(ui::narrow(tema::tracado("×"), 12.0, Weight::Bold, tema::SERIGRAFIA))
                .push(escudo(&j.fora))
                .spacing(10)
                .align_y(Alignment::Center),
        )
        .push(ident)
        .spacing(16)
        .align_y(Alignment::Center);
    if (rolando || terminou) && j.casa.placar.is_some() && j.fora.placar.is_some() {
        linha = linha.push(ui::texto(
            format!("{}–{}", j.casa.placar.unwrap(), j.fora.placar.unwrap()),
            27.0,
            Weight::ExtraBold,
            tema::LEITURA,
        ));
    }
    Some(cosmic::widget::container(linha).width(Length::Fill).center_x(Length::Fill).into())
}
