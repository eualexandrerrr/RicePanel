// Peças pequenas que todas as placas usam: rótulo, texto de leitura, cabeçalho
// de placa com botões de pílula, régua.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Background, Color, Length};
use cosmic::theme;
use cosmic::widget::{Row, button, container, text};

use super::Message;
use crate::tema;

pub type Texto<'a> = cosmic::iced::widget::Text<'a, cosmic::Theme, cosmic::Renderer>;

pub fn rotulo<'a>(s: &str) -> Texto<'a> {
    text(tema::tracado(s)).size(11.5).font(tema::narrow(Weight::Bold)).class(theme::Text::Color(tema::SERIGRAFIA))
}

pub fn rotulo_cor<'a>(s: &str, cor: Color) -> Texto<'a> {
    text(tema::tracado(s)).size(11.5).font(tema::narrow(Weight::Bold)).class(theme::Text::Color(cor))
}

pub fn leitura<'a>(s: impl Into<String>, tam: f32) -> Texto<'a> {
    text(s.into()).size(tam).font(tema::archivo(Weight::Normal)).class(theme::Text::Color(tema::LEITURA))
}

pub fn texto<'a>(s: impl Into<String>, tam: f32, peso: Weight, cor: Color) -> Texto<'a> {
    text(s.into()).size(tam).font(tema::archivo(peso)).class(theme::Text::Color(cor))
}

pub fn narrow<'a>(s: impl Into<String>, tam: f32, peso: Weight, cor: Color) -> Texto<'a> {
    text(s.into()).size(tam).font(tema::narrow(peso)).class(theme::Text::Color(cor))
}

// Botão de cabeçalho: pílula, raio total, face que recebe toque.
pub fn pilula<'a>(conteudo: impl Into<Element<'a, Message>>, msg: Message) -> button::Button<'a, Message> {
    fn face(alfa: f32) -> cosmic::widget::button::Style {
        cosmic::widget::button::Style {
            background: Some(Background::Color(Color { a: alfa, ..tema::TEXT })),
            text_color: Some(tema::LEITURA),
            icon_color: Some(tema::LEITURA),
            border_radius: 999.0.into(),
            border_width: 1.0,
            border_color: Color { a: 0.10, ..tema::TEXT },
            ..Default::default()
        }
    }
    button::custom(conteudo)
        .padding([4, 9])
        .on_press(msg)
        .class(theme::Button::Custom {
            active: Box::new(|_, _| face(0.08)),
            disabled: Box::new(|_| face(0.04)),
            hovered: Box::new(|_, _| face(0.18)),
            pressed: Box::new(|_, _| face(0.22)),
        })
}

pub fn pilula_texto<'a>(s: &str, msg: Message) -> button::Button<'a, Message> {
    pilula(narrow(tema::tracado(s), 10.5, Weight::Bold, tema::LEITURA), msg)
}

pub fn icone<'a>(nome: &'static str) -> Element<'a, Message> {
    cosmic::widget::icon::from_name(nome).size(14).symbolic(true).into()
}

// Cabeçalho de placa: rótulo no meio, botões encostados na direita.
pub fn cabecalho<'a>(nome: &str, extra: Option<Texto<'a>>, acoes: Vec<Element<'a, Message>>) -> Element<'a, Message> {
    let mut titulo = Row::new().push(rotulo(nome)).spacing(10).align_y(Alignment::Center);
    if let Some(e) = extra {
        titulo = titulo.push(e);
    }
    let mut botoes = Row::new().spacing(4).align_y(Alignment::Center);
    for a in acoes {
        botoes = botoes.push(a);
    }
    cosmic::iced::widget::Stack::new()
        .push(container(titulo).width(Length::Fill).center_x(Length::Fill))
        .push(container(botoes).width(Length::Fill).align_x(cosmic::iced::alignment::Horizontal::Right))
        .width(Length::Fill)
        .into()
}

pub fn regua<'a>(largura: Length) -> Element<'a, Message> {
    crate::widgets::trilho::trilho(0.0, Color::TRANSPARENT).altura(1.0).width(largura).into()
}

