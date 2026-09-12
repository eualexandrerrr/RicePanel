// A travessa: a única coisa ancorada no topo. Fala o idioma da waybar, copiado
// dos valores do `style.css` dele: grupo `alpha(base, 0.82)` com aresta de
// `surface0`, tecla de raio 9 com margem 3, ativa em degradê mauve → azul.
//
// Só o Mirante mora aqui. As outras três teclas abrem a Estação, que continua
// no Electron do diretório de cima, como janela por cima da parede.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::gradient::{Gradient, Linear};
use cosmic::iced::{Alignment, Background, Border, Color, Length, Radians};
use cosmic::theme;
use cosmic::widget::{Row, button, container};

use super::ui;
use super::Message;
use crate::tema;

const TECLAS: [(&str, &str); 4] = [("mirante", "Mirante"), ("servidores", "Servidores"), ("dev", "Dev"), ("monitor", "Monitor")];

fn tecla<'a>(id: &'static str, nome: &'static str) -> Element<'a, Message> {
    let ativa = id == "mirante";
    let rot = cosmic::widget::text(nome)
        .size(12)
        .font(tema::mono(if ativa { Weight::Bold } else { Weight::Semibold }))
        .class(theme::Text::Color(if ativa { tema::BASE } else { tema::SUBTEXT0 }));
    let estilo = move |hover: bool| {
        let fundo = if ativa {
            Some(Background::Gradient(Gradient::Linear(
                Linear::new(Radians(135f32.to_radians())).add_stop(0.0, tema::MAUVE).add_stop(1.0, tema::BLUE),
            )))
        } else if hover {
            Some(Background::Color(Color { a: 0.8, ..tema::SURFACE0 }))
        } else {
            None
        };
        cosmic::widget::button::Style {
            background: fundo,
            text_color: Some(if ativa { tema::BASE } else if hover { tema::TEXT } else { tema::SUBTEXT0 }),
            border_radius: 9.0.into(),
            ..Default::default()
        }
    };
    let mut b = button::custom(rot).padding([7, 15]).class(theme::Button::Custom {
        active: Box::new(move |_, _| estilo(false)),
        disabled: Box::new(move |_| estilo(false)),
        hovered: Box::new(move |_, _| estilo(true)),
        pressed: Box::new(move |_, _| estilo(true)),
    });
    if !ativa {
        b = b.on_press(Message::AbrirEstacao(id));
    }
    container(b).padding([3, 2]).into()
}

pub fn view<'a>() -> Element<'a, Message> {
    let mut grupo = Row::new().align_y(Alignment::Center);
    for (id, nome) in TECLAS {
        grupo = grupo.push(tecla(id, nome));
    }
    let barramento = container(grupo).padding([0, 6]).class(theme::Container::Custom(Box::new(|_| {
        cosmic::iced::widget::container::Style {
            background: Some(Background::Color(Color { a: 0.82, ..tema::BASE })),
            border: Border { radius: 14.0.into(), width: 1.0, color: Color { a: 0.9, ..tema::SURFACE0 } },
            ..Default::default()
        }
    })));
    let marca = Row::new()
        .push(ui::narrow(tema::tracado("Mesa"), 17.0, Weight::Bold, tema::LEITURA))
        .push(ui::narrow(".", 17.0, Weight::Bold, tema::AMBAR));
    container(Row::new().push(marca).push(barramento).spacing(14).align_y(Alignment::Center))
        .padding([8, 14, 0, 14])
        .height(Length::Fixed(54.0))
        .center_y(Length::Fixed(54.0))
        .width(Length::Fill)
        .into()
}
