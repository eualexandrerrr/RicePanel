// O mês: uma tabela de números, não uma parede de lajotas. Só o hoje ganha
// corpo, um círculo de 30px no acento; dia com compromisso ganha ponto.

use chrono::{Datelike, Local, NaiveDate};
use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Background, Border, Color, Length};
use cosmic::theme;
use cosmic::widget::{Column, Row, container, text};

use super::ui::{self, pilula_texto};
use super::{Message, Mirante};
use crate::tema;

const MESES: [&str; 12] = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const CABECA: [&str; 7] = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

pub fn mes_base(m: &Mirante) -> NaiveDate {
    m.mes_visto.unwrap_or_else(|| {
        let h = Local::now().date_naive();
        NaiveDate::from_ymd_opt(h.year(), h.month(), 1).unwrap()
    })
}

pub fn soma_meses(d: NaiveDate, n: i32) -> NaiveDate {
    let total = d.year() * 12 + d.month0() as i32 + n;
    NaiveDate::from_ymd_opt(total.div_euclid(12), (total.rem_euclid(12) + 1) as u32, 1).unwrap()
}

fn celula<'a>(dia: NaiveDate, base: NaiveDate, hoje: NaiveDate, com_evento: bool) -> Element<'a, Message> {
    let fora = dia.month() != base.month();
    let fds = matches!(dia.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun);
    let eh_hoje = dia == hoje;
    let cor = if eh_hoje {
        tema::SOBRE_ACENTO
    } else if fora {
        Color { a: 0.55, ..tema::OVERLAY0 }
    } else if fds {
        tema::OVERLAY1
    } else {
        tema::SUBTEXT1
    };
    let numero = text(dia.day().to_string())
        .size(16)
        .font(tema::archivo(if eh_hoje { Weight::Semibold } else { Weight::Normal }))
        .class(theme::Text::Color(cor));
    let miolo: Element<'a, Message> = if eh_hoje {
        container(numero)
            .width(Length::Fixed(30.0))
            .height(Length::Fixed(30.0))
            .center(Length::Fixed(30.0))
            .class(theme::Container::Custom(Box::new(|_| cosmic::iced::widget::container::Style {
                background: Some(Background::Color(tema::ACENTO)),
                border: Border { radius: 15.0.into(), ..Default::default() },
                ..Default::default()
            })))
            .into()
    } else {
        numero.into()
    };
    let ponto_cor = if eh_hoje { tema::SOBRE_ACENTO } else if com_evento && !fora { tema::SAPPHIRE } else { Color::TRANSPARENT };
    let ponto = container(cosmic::widget::Space::new().width(Length::Fixed(3.0)).height(Length::Fixed(3.0)))
        .class(theme::Container::Custom(Box::new(move |_| cosmic::iced::widget::container::Style {
            background: Some(Background::Color(ponto_cor)),
            border: Border { radius: 2.0.into(), ..Default::default() },
            ..Default::default()
        })));
    container(
        Column::new()
            .push(container(miolo).height(Length::Fixed(32.0)).center_y(Length::Fixed(32.0)))
            .push(ponto)
            .align_x(Alignment::Center)
            .spacing(1),
    )
    .width(Length::Fill)
    .height(Length::Fixed(42.0))
    .center_x(Length::Fill)
    .into()
}

pub fn view<'a>(m: &'a Mirante) -> Element<'a, Message> {
    let base = mes_base(m);
    let hoje = Local::now().date_naive();
    let nome = format!("{} de {}", MESES[base.month0() as usize], base.year());

    let cabecalho = ui::cabecalho(
        &nome,
        None,
        vec![
            pilula_texto("Hoje", Message::MesHoje).into(),
            pilula_texto("‹", Message::MesAnterior).into(),
            pilula_texto("›", Message::MesProximo).into(),
        ],
    );

    let mut cab = Row::new().spacing(0);
    for c in CABECA {
        cab = cab.push(
            container(ui::narrow(tema::tracado(c), 10.5, Weight::Bold, tema::OVERLAY1))
                .width(Length::Fill)
                .center_x(Length::Fill),
        );
    }

    // A grade começa no domingo da semana do dia 1 e vai até fechar semanas
    // inteiras; a sexta semana só entra quando o mês atravessa seis.
    let primeiro = base;
    let deslocamento = primeiro.weekday().num_days_from_sunday() as i64;
    let mut cursor = primeiro - chrono::Duration::days(deslocamento);
    let mut grade = Column::new().push(cab).spacing(0);
    for semana in 0..6 {
        if semana == 5 && cursor.month() != base.month() {
            break;
        }
        let mut linha = Row::new();
        for _ in 0..7 {
            linha = linha.push(celula(cursor, base, hoje, m.dias_com_evento.contains(&cursor)));
            cursor += chrono::Duration::days(1);
        }
        grade = grade.push(linha);
    }

    Column::new()
        .push(cabecalho)
        .push(container(grade).padding([8, 10, 4, 10]))
        .spacing(6)
        .width(Length::Fill)
        .into()
}
