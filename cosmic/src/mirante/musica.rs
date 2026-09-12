// A placa da música: pílula, uma linha de conteúdo. Só o Spotify ganha marca e
// botões — é o player que responde a MPRIS de forma confiável.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Length};
use cosmic::widget::{Column, Row, container};

use super::ui::{self, pilula};
use super::{Message, Mirante};
use crate::musica::eh_spotify;
use crate::tema;
use crate::widgets::trilho::trilho;

fn hhmm(seg: u64) -> String {
    format!("{}:{:02}", seg / 60, seg % 60)
}

pub fn view<'a>(m: &'a Mirante) -> Option<Element<'a, Message>> {
    let mu = m.musica.as_ref()?;
    if mu.titulo.is_empty() {
        return None;
    }
    let spotify = eh_spotify(mu);
    let mut linha = Row::new().spacing(16).align_y(Alignment::Center);
    if spotify {
        linha = linha.push(cosmic::widget::icon::from_name("spotify").size(22));
    }
    let rodape = match (mu.duracao, mu.posicao) {
        (Some(d), Some(p)) => format!("{} · {} / {}", mu.player, hhmm(p), hhmm(d)),
        _ => mu.player.clone(),
    };
    let corpo = Column::new()
        .push(ui::rotulo(&rodape))
        .push(ui::texto(mu.titulo.clone(), 14.0, Weight::Medium, tema::LEITURA))
        .push(ui::texto(if mu.artista.is_empty() { "—".into() } else { mu.artista.clone() }, 12.0, Weight::Normal, tema::OVERLAY1))
        .spacing(2)
        .align_x(Alignment::Center)
        .max_width(380.0);
    linha = linha.push(corpo);
    if spotify {
        let alterna = if mu.tocando { "media-playback-pause-symbolic" } else { "media-playback-start-symbolic" };
        linha = linha.push(
            Row::new()
                .push(pilula(ui::icone("media-skip-backward-symbolic"), Message::MusicaComando("anterior")))
                .push(pilula(ui::icone(alterna), Message::MusicaComando("alterna")))
                .push(pilula(ui::icone("media-skip-forward-symbolic"), Message::MusicaComando("proximo")))
                .spacing(4),
        );
    }
    let f = match (mu.duracao, mu.posicao) {
        (Some(d), Some(p)) if d > 0 => (p as f32 / d as f32).clamp(0.0, 1.0),
        _ => 0.0,
    };
    Some(
        Column::new()
            .push(container(linha).width(Length::Fill).center_x(Length::Fill))
            .push(container(trilho(f, tema::ACENTO).altura(3.0)).padding([6, 32, 0, 32]))
            .width(Length::Fill)
            .into(),
    )
}
