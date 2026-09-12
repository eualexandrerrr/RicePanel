// A placa de vídeo: o quadro em 16/9, o pé com o título e de onde vem.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, Background, Border, ContentFit, Length};
use cosmic::theme;
use cosmic::widget::{Column, Row, container, image};

use super::ui::{self, pilula};
use super::{Message, Mirante};
use crate::tema;
use crate::video::Site;

// Escala 1.0 = coluna de 620 px. O teto é a largura do monitor em pé menos a
// margem; o piso ainda deixa ler o placar de um jogo.
pub const ESCALA_MIN: f32 = 0.75;
pub const ESCALA_MAX: f32 = 1.65;
pub const PASSO: f32 = 0.15;

pub fn largura(escala: f32) -> f32 {
    (super::COLUNA * escala.clamp(ESCALA_MIN, ESCALA_MAX)).round()
}

pub struct NaParede {
    pub site: Site,
    pub titulo: String,
    pub quadro: Option<image::Handle>,
    pub pausado: bool,
    pub volume: f64,
}

// Mais de um vídeo tocando fora da vista: o painel pergunta, não adivinha.
fn escolha<'a>(m: &'a Mirante) -> Option<Element<'a, Message>> {
    if m.candidatos.len() < 2 {
        return None;
    }
    let mut lista = Column::new()
        .push(ui::rotulo("Qual vídeo vai para a parede?"))
        .spacing(8)
        .align_x(Alignment::Center)
        .width(Length::Fill);
    for c in &m.candidatos {
        let onde = if matches!(c.site, Site::Drm) { "Globoplay" } else { "YouTube" };
        lista = lista.push(
            pilula(
                Row::new()
                    .push(ui::texto(c.titulo.clone(), 14.0, Weight::Normal, tema::LEITURA))
                    .push(cosmic::widget::Space::new().width(Length::Fill))
                    .push(ui::rotulo(onde))
                    .spacing(12)
                    .align_y(Alignment::Center)
                    .width(Length::Fill),
                Message::VideoEscolher(c.aba),
            )
            .padding([10, 16])
            .width(Length::Fill),
        );
    }
    Some(container(lista).padding([16, 18]).width(Length::Fill).into())
}

pub fn view<'a>(m: &'a Mirante) -> Option<Element<'a, Message>> {
    if let Some(e) = escolha(m) {
        return Some(e);
    }
    let v = m.video.as_ref()?;
    let altura = (largura(m.video_escala) * 9.0 / 16.0).round();
    let quadro: Element<'a, Message> = match (&v.site, &v.quadro) {
        (Site::Youtube(_), Some(h)) => image(h.clone())
            .width(Length::Fill)
            .height(Length::Fixed(altura))
            .content_fit(ContentFit::Contain)
            .into(),
        (Site::Youtube(_), None) => container(ui::rotulo("carregando o vídeo"))
            .width(Length::Fill)
            .height(Length::Fixed(altura))
            .center(Length::Fill)
            .into(),
        (Site::Drm, _) | (Site::Nenhum, _) => container(
            Column::new()
                .push(ui::rotulo("Tocando no navegador"))
                .push(ui::texto(v.titulo.clone(), 15.0, Weight::Normal, tema::LEITURA))
                .push(ui::rotulo("O serviço usa DRM e não roda dentro do painel"))
                .spacing(6)
                .align_x(Alignment::Center),
        )
        .padding([16, 20])
        .width(Length::Fill)
        .center_x(Length::Fill)
        .into(),
    };
    let fundo = container(quadro)
        .width(Length::Fill)
        .class(theme::Container::Custom(Box::new(|_| cosmic::iced::widget::container::Style {
            background: Some(Background::Color(cosmic::iced::Color::BLACK)),
            border: Border { radius: [tema::VIDRO_RAIO, tema::VIDRO_RAIO, 0.0, 0.0].into(), ..Default::default() },
            ..Default::default()
        })));
    let onde = match v.site {
        Site::Youtube(_) => "YouTube",
        _ => "Navegador",
    };
    let mut pe = Row::new().spacing(10).align_y(Alignment::Center);
    // Pausa e volume só existem quando é o painel que toca; no DRM quem toca é
    // o navegador, e botão que não manda em nada é pior que botão nenhum.
    if matches!(v.site, Site::Youtube(_)) {
        let icone = if v.pausado { "media-playback-start-symbolic" } else { "media-playback-pause-symbolic" };
        let mudo = v.volume <= 0.001;
        pe = pe
            .push(pilula(ui::icone(icone), Message::VideoPausa).padding([6, 12]))
            .push(
                Row::new()
                    .push(pilula(ui::icone("audio-volume-low-symbolic"), Message::VideoVolume(-10)).padding([6, 10]))
                    .push(
                        container(ui::texto(if mudo { "mudo".into() } else { format!("{:.0}%", v.volume * 100.0) }, 12.5, Weight::Normal, tema::LEITURA))
                            .width(Length::Fixed(44.0))
                            .center_x(Length::Fixed(44.0)),
                    )
                    .push(pilula(ui::icone("audio-volume-high-symbolic"), Message::VideoVolume(10)).padding([6, 10]))
                    .spacing(4)
                    .align_y(Alignment::Center),
            );
    }
    // Tamanho da placa: fica gravado e vale como padrão para o próximo vídeo.
    pe = pe.push(
        Row::new()
            .push(pilula(ui::icone("zoom-out-symbolic"), Message::VideoTamanho(-1)).padding([6, 10]))
            .push(pilula(ui::icone("zoom-in-symbolic"), Message::VideoTamanho(1)).padding([6, 10]))
            .spacing(4),
    );
    pe = pe
        .push(ui::texto(v.titulo.clone(), 13.5, Weight::Normal, tema::LEITURA))
        .push(cosmic::widget::Space::new().width(Length::Fill))
        .push(ui::rotulo(onde));
    Some(
        Column::new()
            .push(fundo)
            .push(container(pe).padding([9, 14, 11, 14]))
            .width(Length::Fill)
            .into(),
    )
}
