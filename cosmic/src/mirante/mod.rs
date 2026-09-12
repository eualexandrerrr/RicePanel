// Página 1: o Mirante. Luz sobre vidro, tudo centrado.
//
// Ordem da coluna, a mesma do painel antigo: mês+agenda, vitais, máquina,
// música, hora, jogo, lançamento. A hora fecha o grupo centrado; o que sobra
// vira respiro entre os blocos.

pub mod agenda;
pub mod hora;
pub mod jogo;
pub mod lancamento;
pub mod maquina;
pub mod mes;
pub mod travessa;
pub mod musica;
pub mod ui;
pub mod video;
pub mod vitais;

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Local, NaiveDate};
use cosmic::Element;
use cosmic::iced::{Alignment, Length};
use cosmic::widget::{Column, container};
use image::RgbaImage;

use crate::placa::placa;
use crate::sistema::{Pacotes, Retrato};

// Largura da coluna: placa de ponta a ponta em 1080 lê como barra, não widget.
pub const COLUNA: f32 = 620.0;

#[derive(Debug, Clone)]
pub enum Message {
    MesAnterior,
    MesProximo,
    MesHoje,
    AgendaRecarregar,
    AgendaConfigurar,
    MusicaComando(&'static str),
    VideoAlterna,
    VideoPausa,
    VideoVolume(i32),
    AbrirEstacao(&'static str),
    VideoEscolher(i64),
    VideoTamanho(i32),
}

// O que a página pede ao app depois de tratar uma mensagem.
pub enum Saida {
    Nada,
    AgendaRecarregar,
    AgendaConfigurar,
    MusicaComando(&'static str, String),
    VideoAlterna,
    VideoPausa,
    VideoVolume(i32),
    AbrirEstacao(&'static str),
    VideoEscolher(i64),
    VideoTamanho(i32),
}

pub struct Mirante {
    pub agora: DateTime<Local>,
    pub pontos_acesos: bool,
    pub retrato: Option<Retrato>,
    pub pacotes: Pacotes,
    pub janela_foco: Option<String>,
    pub agenda: crate::agenda::Agenda,
    pub dias_com_evento: HashSet<NaiveDate>,
    pub mes_visto: Option<NaiveDate>,
    pub jogo: crate::flamengo::Estado,
    pub musica: Option<crate::musica::Musica>,
    pub video: Option<video::NaParede>,
    pub candidatos: Vec<crate::video::Candidato>,
    pub video_ligado: bool,
    pub video_escala: f32,
}

impl Default for Mirante {
    fn default() -> Self {
        let agenda = crate::agenda::ler_cache();
        let dias = agenda.dias_com_evento();
        Self {
            agora: Local::now(),
            pontos_acesos: true,
            retrato: None,
            pacotes: Pacotes::default(),
            janela_foco: None,
            agenda,
            dias_com_evento: dias,
            mes_visto: None,
            jogo: crate::flamengo::ler_cache(),
            musica: None,
            video: None,
            candidatos: Vec::new(),
            video_ligado: false,
            video_escala: 1.0,
        }
    }
}

impl Mirante {
    pub fn segundo(&mut self) {
        self.agora = Local::now();
        self.pontos_acesos = !self.pontos_acesos;
    }

    pub fn poe_agenda(&mut self, a: crate::agenda::Agenda) {
        self.dias_com_evento = a.dias_com_evento();
        self.agenda = a;
    }

    pub fn update(&mut self, m: Message) -> Saida {
        match m {
            Message::MesAnterior => {
                self.mes_visto = Some(mes::soma_meses(mes::mes_base(self), -1));
                Saida::Nada
            }
            Message::MesProximo => {
                self.mes_visto = Some(mes::soma_meses(mes::mes_base(self), 1));
                Saida::Nada
            }
            Message::MesHoje => {
                self.mes_visto = None;
                Saida::Nada
            }
            Message::AgendaRecarregar => Saida::AgendaRecarregar,
            Message::AgendaConfigurar => Saida::AgendaConfigurar,
            Message::MusicaComando(v) => Saida::MusicaComando(v, self.musica.as_ref().map(|m| m.player.clone()).unwrap_or_default()),
            Message::VideoAlterna => Saida::VideoAlterna,
            Message::VideoPausa => Saida::VideoPausa,
            Message::VideoVolume(d) => Saida::VideoVolume(d),
            Message::AbrirEstacao(m) => Saida::AbrirEstacao(m),
            Message::VideoEscolher(a) => Saida::VideoEscolher(a),
            Message::VideoTamanho(d) => Saida::VideoTamanho(d),
        }
    }

    pub fn view(&self, vidro: Option<Arc<RgbaImage>>) -> Element<'_, Message> {
        let v = || vidro.clone();

        // Mês e agenda: a mesma pergunta, uma placa só.
        let tempo = placa(
            v(),
            Column::new()
                .push(mes::view(self))
                .push(container(ui::regua(Length::Fill)).padding([6, 14, 0, 14]))
                .push(agenda::view(self))
                .spacing(4)
                .width(Length::Fill),
        )
        .padding([14, 16, 6, 16]);

        let vitais = placa(v(), vitais::view(self)).padding([2, 0, 0, 0]);
        let com_video = self.video.is_some() || self.candidatos.len() > 1;

        // A placa de vídeo pode passar da coluna quando ele aumenta: a coluna
        // acompanha, e o resto das placas centra dentro dela na largura de sempre.
        let largura_video = video::largura(self.video_escala);
        let largura = if com_video { COLUNA.max(largura_video) } else { COLUNA };
        let mut coluna = Column::new()
            .push(container(tempo).width(Length::Fixed(COLUNA)))
            .push(container(vitais).width(Length::Fixed(COLUNA)))
            .spacing(22)
            .width(Length::Fixed(largura))
            .align_x(Alignment::Center);

        // Com vídeo na tela, o que é lembrete some: a ficha da máquina e a
        // contagem voltam quando o vídeo sai. A música também cala: o vídeo é o
        // que ele está vendo, e um player embaixo dele é ruído.
        if !com_video {
            coluna = coluna.push(placa(v(), maquina::view(self)).gaze().padding([10, 14]));
            if let Some(m) = musica::view(self) {
                coluna = coluna.push(placa(v(), m).raio(999.0).padding([13, 28, 12, 28]));
            }
        }
        if let Some(vd) = video::view(self) {
            coluna = coluna.push(placa(v(), vd).padding(0).width(Length::Fixed(largura_video)));
        }
        coluna = coluna.push(hora::view(self, v()));
        if let Some(j) = jogo::view(self) {
            coluna = coluna.push(placa(v(), j).padding([14, 18]));
        }
        if !com_video {
            coluna = coluna.push(placa(v(), lancamento::view()).padding([16, 20]));
        }

        // A coluna se centra nos dois eixos; só a travessa fica no topo.
        Column::new()
            .push(travessa::view())
            .push(
                container(coluna)
                    .width(Length::Fill)
                    .height(Length::Fill)
                    .center_x(Length::Fill)
                    .center_y(Length::Fill),
            )
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
    }
}
