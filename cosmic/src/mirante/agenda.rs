// A lista da agenda: linha, não cartão. Hora, filete de estado à esquerda,
// texto. Coluna de 430px centrada; dentro dela a linha é alinhada à esquerda.

use chrono::{DateTime, Datelike, Local};
use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Background, Color, Length};
use cosmic::theme;
use cosmic::widget::{Column, Row, container, scrollable};

use super::ui::{self, pilula};
use super::{Message, Mirante};
use crate::agenda::Evento;
use crate::tema;

const DIAS: [&str; 7] = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const MESES_CURTO: [&str; 12] = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

pub fn rotulo_do_dia(d: &DateTime<Local>) -> String {
    let hoje = Local::now().date_naive();
    let dia = d.date_naive();
    if dia == hoje {
        "Hoje".into()
    } else if dia == hoje + chrono::Duration::days(1) {
        "Amanhã".into()
    } else {
        format!("{}, {} de {}", DIAS[dia.weekday().num_days_from_monday() as usize], dia.day(), MESES_CURTO[dia.month0() as usize])
    }
}

fn vazio<'a>(frase: &str) -> Element<'a, Message> {
    container(
        Column::new()
            .push(crate::widgets::anel::calmo())
            .push(ui::narrow(tema::tracado(frase), 12.0, Weight::Bold, tema::OVERLAY1).align_x(cosmic::iced::alignment::Horizontal::Center))
            .spacing(10)
            .align_x(Alignment::Center),
    )
    .padding([18, 10, 14, 10])
    .width(Length::Fill)
    .center_x(Length::Fill)
    .into()
}

fn item<'a>(e: &Evento, agora: DateTime<Local>) -> Element<'a, Message> {
    let acabou = match e.fim {
        Some(f) => f < agora,
        None => e.inicio + chrono::Duration::hours(1) < agora,
    };
    let rolando = e.inicio <= agora && !acabou;
    let filete = if rolando { tema::GREEN } else if acabou { tema::OVERLAY0 } else { tema::SAPPHIRE };
    let alfa = if acabou { 0.38 } else { 1.0 };
    let hora = if e.dia_inteiro { "dia".to_string() } else { e.inicio.format("%H:%M").to_string() };

    let mut texto = Column::new()
        .push(ui::texto(e.titulo.clone(), 15.0, Weight::Normal, Color { a: alfa, ..tema::LEITURA }))
        .spacing(1);
    if !e.local.is_empty() {
        texto = texto.push(ui::texto(e.local.clone(), 12.5, Weight::Normal, Color { a: alfa, ..tema::SERIGRAFIA }));
    }
    let barra = container(cosmic::widget::Space::new().width(Length::Fixed(2.0)).height(Length::Fill))
        .class(theme::Container::Custom(Box::new(move |_| cosmic::iced::widget::container::Style {
            background: Some(Background::Color(Color { a: alfa, ..filete })),
            ..Default::default()
        })));
    container(
        Row::new()
            .push(barra)
            .push(container(ui::texto(hora, 15.0, Weight::Normal, Color { a: alfa, ..tema::LEITURA })).width(Length::Fixed(50.0)))
            .push(texto)
            .spacing(11)
            .align_y(Alignment::Start),
    )
    .padding([6, 0])
    .width(Length::Fill)
    .into()
}

pub fn view<'a>(m: &'a Mirante) -> Element<'a, Message> {
    let a = &m.agenda;
    let quando = if a.erro.is_some() {
        Some(ui::rotulo("sem conexão"))
    } else {
        a.atualizado_em.map(|t| ui::rotulo(&format!("lida {}", t.format("%H:%M"))))
    };
    let cabecalho = ui::cabecalho(
        "Agenda",
        quando,
        vec![
            pilula(ui::icone("emblem-system-symbolic"), Message::AgendaConfigurar).into(),
            pilula(ui::icone("view-refresh-symbolic"), Message::AgendaRecarregar).into(),
        ],
    );

    let corpo: Element<'a, Message> = if !a.tem_url {
        vazio("Sem calendário ligado — abra o ajuste e cole o endereço iCal.")
    } else if a.eventos.is_empty() {
        vazio("Nada marcado pelos próximos dias.")
    } else {
        let agora = Local::now();
        let mut lista = Column::new().spacing(1).width(Length::Fill);
        let mut dia_aberto = None;
        for e in a.eventos.iter().take(15) {
            let chave = e.inicio.date_naive();
            if dia_aberto != Some(chave) {
                dia_aberto = Some(chave);
                lista = lista.push(
                    container(ui::narrow(tema::tracado(&rotulo_do_dia(&e.inicio)), 10.0, Weight::Bold, tema::OVERLAY1))
                        .padding([10, 0, 4, 0])
                        .width(Length::Fill)
                        .center_x(Length::Fill),
                );
            }
            lista = lista.push(item(e, agora));
        }
        container(scrollable(container(lista).width(Length::Fixed(430.0))).height(Length::Shrink))
            .width(Length::Fill)
            .center_x(Length::Fill)
            .max_height(560.0)
            .padding([4, 0, 14, 0])
            .into()
    };

    Column::new().push(cabecalho).push(corpo).spacing(6).width(Length::Fill).into()
}
