// A máquina em si, sem recipiente: janela em foco, ficha e pacotes. LUZ sobre GAZE.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Length};
use cosmic::widget::{Column, Row};

use super::ui;
use super::{Message, Mirante};
use crate::tema;

fn linha<'a>(rotulo: &str, valor: String) -> Element<'a, Message> {
    Row::new()
        .push(ui::rotulo(rotulo))
        .push(ui::texto(valor, 14.0, Weight::Normal, tema::LEITURA))
        .spacing(9)
        .align_y(Alignment::End)
        .into()
}

pub fn view<'a>(m: &'a Mirante) -> Element<'a, Message> {
    let mut c = Column::new().spacing(9).align_x(Alignment::Center).width(Length::Fill);
    if let Some(j) = &m.janela_foco {
        if !j.is_empty() {
            c = c.push(ui::texto(j.clone(), 13.5, Weight::Normal, tema::SERIGRAFIA));
        }
    }
    let (distro, kernel, quem) = match &m.retrato {
        Some(r) => (r.distro.clone(), r.kernel.clone(), format!("{}@{}", r.usuario, r.host)),
        None => ("—".into(), "—".into(), "—".into()),
    };
    let ficha = Row::new()
        .push(linha("Sistema", distro))
        .push(linha("Kernel", kernel))
        .push(linha("Máquina", quem))
        .spacing(20)
        .align_y(Alignment::End);

    let p = &m.pacotes;
    let pacotes = if p.total() == 0 {
        "sistema em dia".to_string()
    } else {
        let mut partes = vec![];
        if p.repo > 0 {
            partes.push(format!("{} repo", p.repo));
        }
        if p.aur > 0 {
            partes.push(format!("{} AUR", p.aur));
        }
        let origem = if partes.len() > 1 {
            format!(" · {}", partes.join(" · "))
        } else if let Some(um) = partes.first() {
            format!(" do {}", um.split(' ').nth(1).unwrap_or(""))
        } else {
            String::new()
        };
        format!("{} {}{origem} a atualizar", p.total(), if p.total() == 1 { "pacote" } else { "pacotes" })
    };
    // A chave do vídeo mora aqui, na ficha: é o único lugar que fica na tela o
    // dia todo, e ela precisa existir também quando não há vídeo nenhum.
    let chave = ui::pilula_texto(
        if m.video_ligado { "Vídeo na parede · ligado" } else { "Vídeo na parede · desligado" },
        Message::VideoAlterna,
    );
    c = c.push(ficha).push(
        Row::new()
            .push(ui::rotulo(&pacotes))
            .push(chave)
            .spacing(18)
            .align_y(Alignment::Center),
    );
    c.into()
}
