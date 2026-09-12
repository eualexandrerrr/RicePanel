// A casca: uma layer surface na camada de baixo do monitor em pé.

use std::sync::Arc;

use cosmic::app::{Core, Settings, Task};
use cosmic::cctk::sctk::shell::wlr_layer::{Anchor, KeyboardInteractivity, Layer};
use cosmic::cosmic_config::{self, ConfigSet};
use cosmic::iced::event::listen_raw;
use cosmic::iced::platform_specific::runtime::wayland::layer_surface::{IcedOutput, SctkLayerSurfaceSettings};
use cosmic::iced::platform_specific::shell::commands::blur::blur;
use cosmic::iced::platform_specific::shell::commands::layer_surface::{destroy_layer_surface, get_layer_surface};
use cosmic::iced::runtime::core::event::wayland::{LayerEvent, OutputEvent};
use cosmic::iced::runtime::core::event::{PlatformSpecific, wayland};
use cosmic::iced::runtime::core::layout::Limits;
use cosmic::iced::runtime::core::window::Id as SurfaceId;
use cosmic::iced::{Subscription, time};
use cosmic::cctk::wayland_client::protocol::wl_output::WlOutput;
use cosmic::Element;

use crate::config::{APP_ID, Config};
use crate::mirante::Mirante;
use crate::{agenda, flamengo, mirante, musica, sistema, tema, video, vidro};

pub fn run() -> cosmic::iced::Result {
    cosmic::app::run::<App>(
        Settings::default()
            .antialiasing(true)
            .client_decorations(false)
            .default_font(tema::archivo(cosmic::iced::font::Weight::Normal))
            .default_text_size(14.0)
            .no_main_window(true)
            .exit_on_close(false)
            .transparent(true),
        (),
    )
}

pub struct App {
    core: Core,
    config: Config,
    config_handle: Option<cosmic_config::Config>,
    saida: Option<(WlOutput, u32, u32)>,
    surface: Option<SurfaceId>,
    vidro: Option<Arc<vidro::Vidro>>,
    mirante: Mirante,
    video_estado: video::Estado,
    video_montado: String,
    video_player: Option<video::Player>,
    video_buscando: bool,
    volume_aplicado: Option<f64>,
    // Volume escolhido nos botões: vence o da aba até o vídeo trocar.
    volume_manual: Option<f64>,
    video_pausado: bool,
    // A aba que ele escolheu na lista, quando havia mais de uma tocando.
    video_escolhida: Option<i64>,
}

#[derive(Debug, Clone)]
pub enum Message {
    Output(OutputEvent, WlOutput),
    Layer(LayerEvent, SurfaceId),
    Config(Config),
    Segundo,
    VidroPronto(Result<Arc<vidro::Vidro>, String>),
    Fonte(Result<(), cosmic::iced::font::Error>),
    Mirante(mirante::Message),
    Tique,
    TiqueLento,
    RetratoMusica(Box<sistema::Retrato>, Option<musica::Musica>),
    Pacotes(sistema::Pacotes),
    AgendaBuscar,
    Agenda(agenda::Agenda),
    JogoBuscar,
    Jogo(flamengo::Estado),
    Video(video::Estado),
    VideoUrls(String, Result<(String, String), String>),
    VideoQuadro,
    Nada,
}

impl App {
    fn abrir_surface(&mut self) -> Task<Message> {
        let Some((saida, w, h)) = self.saida.clone() else { return Task::none() };
        if self.surface.is_some() {
            return Task::none();
        }
        let id = SurfaceId::unique();
        self.surface = Some(id);
        tracing::info!("layer surface em {} ({w}x{h})", self.config.saida);
        let nome = self.config.saida.clone();
        let vidro = cosmic::task::future(async move {
            Message::VidroPronto(vidro::preparar(nome, w, h).await)
        });
        Task::batch(vec![
            get_layer_surface(SctkLayerSurfaceSettings {
                id,
                layer: Layer::Bottom,
                keyboard_interactivity: KeyboardInteractivity::None,
                input_zone: None,
                anchor: Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT,
                output: IcedOutput::Output(saida),
                namespace: "ricepanel".into(),
                margin: Default::default(),
                size: Some((None, None)),
                exclusive_zone: -1,
                size_limits: Limits::NONE,
            }),
            // O compositor desfoca a layer surface inteira por padrão; o vidro
            // das placas é o nosso, recortado e com canto redondo.
            blur(id, None).map(|_| cosmic::Action::None),
            vidro,
        ])
    }

    fn fechar_surface(&mut self) -> Task<Message> {
        match self.surface.take() {
            Some(id) => destroy_layer_surface(id),
            None => Task::none(),
        }
    }
}

// A Estação é o Electron do diretório de cima, com `--estacao --modo=X`. Se ela
// já está de pé, a instância nova só avisa a antiga, que troca de barramento.
fn abrir_estacao(modo: &str, saida: &str) {
    let dir = std::env::var_os("RICEPANEL_ESTACAO_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    let electron = dir.join("node_modules/electron/dist/electron");
    tracing::info!("estação: abre {modo}");
    match std::process::Command::new(&electron)
        .current_dir(&dir)
        .args(["--password-store=basic", "--ozone-platform-hint=auto", ".", "--estacao"])
        .arg(format!("--modo={modo}"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        // Espera numa thread só para o processo não virar zumbi.
        Ok(mut filho) => {
            std::thread::spawn(move || {
                let _ = filho.wait();
            });
        }
        Err(e) => {
            tracing::warn!("estação: {}: {e}", electron.display());
            return;
        }
    }
    // Cliente Wayland não escolhe o monitor em que nasce: a janela cai na saída
    // em foco. Quem a leva para o monitor em pé é o mesmo script que a unit do
    // Electron usava, pelo protocolo de toplevel do COSMIC. Se a Estação já
    // estava de pé, o script só confirma que ela está lá.
    let script = std::env::var_os("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".dotfiles/bin/cosmic-move-window.py"));
    if let Some(script) = script.filter(|p| p.exists()) {
        match std::process::Command::new(&script)
            .args(["--wait", "25", "--fill", "RicePanel", saida])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(mut filho) => {
                std::thread::spawn(move || {
                    let _ = filho.wait();
                });
            }
            Err(e) => tracing::warn!("estação: mover janela: {e}"),
        }
    }
}

impl App {
    // Regra: o painel só assume o vídeo quando a janela que toca não está à
    // vista dele. Assumir é montar o player na posição em que ele parou e
    // pausar a aba; ele voltar para a janela devolve o vídeo e sai da frente.
    fn trata_video(&mut self, e: video::Estado) -> Task<Message> {
        self.mirante.candidatos = e.candidatos.clone();
        // A escolha vale enquanto aquela aba está na lista ou tocando; sumiu, esquece.
        if let Some(esc) = self.video_escolhida {
            if !e.candidatos.iter().any(|c| c.aba == esc) && e.aba != Some(esc) {
                self.video_escolhida = None;
            }
        }
        let assinatura = e.assinatura();
        let deve_montar = self.config.video_ligado && e.site != video::Site::Nenhum && !e.a_vista;
        if !deve_montar {
            let devolve = if self.video_montado.starts_with("youtube") && self.video_player.is_some() {
                let player = self.video_estado.player.clone();
                let aba = self.video_estado.aba;
                Some(cosmic::task::future(async move {
                    video::toca_navegador(player, aba).await;
                    Message::Nada
                }))
            } else {
                None
            };
            self.video_player = None;
            self.video_montado.clear();
            self.mirante.video = None;
            self.video_estado = e;
            return devolve.unwrap_or_else(Task::none);
        }
        if assinatura == self.video_montado {
            // Mesmo vídeo: só acompanha o volume da aba, se ele não mexeu nos botões.
            if let (Some(p), Some(v), None) = (&self.video_player, e.volume, self.volume_manual) {
                if self.volume_aplicado.map(|a| (a - v).abs() >= 0.02).unwrap_or(true) {
                    p.volume(v);
                    self.volume_aplicado = Some(v);
                    if let Some(nv) = self.mirante.video.as_mut() {
                        nv.volume = v;
                    }
                }
            }
            self.video_estado = e;
            return Task::none();
        }
        self.video_player = None;
        self.video_montado = assinatura.clone();
        self.volume_manual = None;
        self.video_pausado = false;
        self.mirante.video = Some(mirante::video::NaParede {
            site: e.site.clone(),
            titulo: e.titulo.clone(),
            quadro: None,
            pausado: false,
            volume: e.volume.unwrap_or(1.0),
        });
        self.video_estado = e.clone();
        tracing::info!(
            "video: assume {assinatura}: {} (volume {})",
            e.titulo,
            e.volume.map(|v| format!("{:.0}%", v * 100.0)).unwrap_or_else(|| "?".into())
        );
        match e.site {
            video::Site::Youtube(id) if !self.video_buscando => {
                self.video_buscando = true;
                cosmic::task::future(async move {
                    let r = video::urls_youtube(&id).await;
                    Message::VideoUrls(id, r)
                })
            }
            _ => Task::none(),
        }
    }
}

impl cosmic::Application for App {
    type Executor = cosmic::executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = APP_ID;

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(mut core: Core, _flags: ()) -> (Self, Task<Message>) {
        core.set_keyboard_nav(false);
        // O tema "frosted" do COSMIC desfocaria a layer surface inteira; o
        // vidro é por placa, e é nosso.
        core.set_auto_blur(Default::default());
        let (config, config_handle) = Config::carregar();
        let mut app = App {
            core,
            config,
            config_handle,
            saida: None,
            surface: None,
            vidro: None,
            mirante: Mirante::default(),
            video_estado: video::Estado::default(),
            video_montado: String::new(),
            video_player: None,
            video_buscando: false,
            volume_aplicado: None,
            volume_manual: None,
            video_pausado: false,
            video_escolhida: None,
        };
        app.mirante.video_ligado = app.config.video_ligado;
        app.mirante.video_escala = app.config.video_escala;
        let fontes = Task::batch(
            tema::FONTES
                .iter()
                .map(|f| cosmic::iced::font::load(*f).map(|r| cosmic::Action::App(Message::Fonte(r)))),
        );
        let primeiro = Task::batch(vec![
            cosmic::task::message(cosmic::Action::App(Message::Tique)),
            cosmic::task::message(cosmic::Action::App(Message::TiqueLento)),
            cosmic::task::message(cosmic::Action::App(Message::AgendaBuscar)),
            cosmic::task::message(cosmic::Action::App(Message::JogoBuscar)),
        ]);
        (app, Task::batch(vec![fontes, primeiro]))
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Output(evento, wl) => match evento {
                OutputEvent::Created(Some(info)) | OutputEvent::InfoUpdate(info) => {
                    let nome = info.name.clone().unwrap_or_default();
                    if nome != self.config.saida {
                        return Task::none();
                    }
                    let (w, h) = info
                        .logical_size
                        .map(|(w, h)| (w.max(1) as u32, h.max(1) as u32))
                        .unwrap_or((1080, 1920));
                    let mudou = self.saida.as_ref().map(|(_, ow, oh)| (*ow, *oh) != (w, h)).unwrap_or(true);
                    self.saida = Some((wl, w, h));
                    if mudou && self.surface.is_some() {
                        // Tamanho novo: refaz o vidro no formato certo.
                        let nome = self.config.saida.clone();
                        return cosmic::task::future(async move {
                            Message::VidroPronto(vidro::preparar(nome, w, h).await)
                        });
                    }
                    self.abrir_surface()
                }
                OutputEvent::Removed => {
                    if let Some((atual, _, _)) = &self.saida {
                        if *atual == wl {
                            self.saida = None;
                            return self.fechar_surface();
                        }
                    }
                    Task::none()
                }
                OutputEvent::Created(None) => Task::none(),
            },
            Message::Layer(evento, id) => {
                if Some(id) == self.surface && matches!(evento, LayerEvent::Unfocused | LayerEvent::Done) {
                    if let LayerEvent::Done = evento {
                        self.surface = None;
                    }
                }
                Task::none()
            }
            Message::Config(nova) => {
                let saida_mudou = nova.saida != self.config.saida;
                let agenda_mudou = nova.agenda_ical != self.config.agenda_ical;
                self.config = nova;
                self.mirante.video_ligado = self.config.video_ligado;
                self.mirante.video_escala = self.config.video_escala;
                if saida_mudou {
                    self.saida = None;
                    return self.fechar_surface();
                }
                if agenda_mudou {
                    return cosmic::task::message(cosmic::Action::App(Message::AgendaBuscar));
                }
                Task::none()
            }
            Message::Segundo => {
                self.mirante.segundo();
                Task::none()
            }
            Message::VidroPronto(Ok(v)) => {
                self.vidro = Some(v);
                Task::none()
            }
            Message::VidroPronto(Err(e)) => {
                tracing::warn!("vidro: {e}");
                Task::none()
            }
            Message::Fonte(Err(e)) => {
                tracing::warn!("fonte: {e:?}");
                Task::none()
            }
            Message::Fonte(Ok(())) => Task::none(),
            Message::Mirante(m) => match self.mirante.update(m) {
                mirante::Saida::Nada => Task::none(),
                mirante::Saida::AgendaRecarregar => cosmic::task::message(cosmic::Action::App(Message::AgendaBuscar)),
                mirante::Saida::AgendaConfigurar => {
                    tracing::info!("agenda: ajuste pelo cosmic-config: {}/v1/agenda_ical", APP_ID);
                    Task::none()
                }
                mirante::Saida::MusicaComando(verbo, player) => cosmic::task::future(async move {
                    musica::comando(verbo, player).await;
                    Message::Nada
                }),
                mirante::Saida::VideoPausa => {
                    self.video_pausado = !self.video_pausado;
                    if let Some(p) = &self.video_player {
                        p.pausar(self.video_pausado);
                    }
                    if let Some(v) = self.mirante.video.as_mut() {
                        v.pausado = self.video_pausado;
                    }
                    Task::none()
                }
                mirante::Saida::VideoVolume(delta) => {
                    let atual = self.volume_manual.or(self.volume_aplicado).unwrap_or(1.0);
                    let novo = ((atual * 100.0).round() + delta as f64).clamp(0.0, 100.0) / 100.0;
                    self.volume_manual = Some(novo);
                    self.volume_aplicado = Some(novo);
                    if let Some(p) = &self.video_player {
                        p.volume(novo);
                    }
                    if let Some(v) = self.mirante.video.as_mut() {
                        v.volume = novo;
                    }
                    Task::none()
                }
                mirante::Saida::VideoTamanho(passo) => {
                    use mirante::video::{ESCALA_MAX, ESCALA_MIN, PASSO};
                    let nova = (self.config.video_escala + passo as f32 * PASSO).clamp(ESCALA_MIN, ESCALA_MAX);
                    self.config.video_escala = nova;
                    self.mirante.video_escala = nova;
                    if let Some(h) = &self.config_handle {
                        if let Err(e) = h.set("video_escala", nova) {
                            tracing::warn!("config: {e}");
                        }
                    }
                    Task::none()
                }
                mirante::Saida::VideoEscolher(aba) => {
                    tracing::info!("video: escolhida a aba {aba}");
                    self.video_escolhida = Some(aba);
                    self.mirante.candidatos.clear();
                    Task::none()
                }
                mirante::Saida::AbrirEstacao(modo) => {
                    abrir_estacao(modo, &self.config.saida);
                    Task::none()
                }
                mirante::Saida::VideoAlterna => {
                    let novo = !self.config.video_ligado;
                    self.config.video_ligado = novo;
                    self.mirante.video_ligado = novo;
                    if let Some(h) = &self.config_handle {
                        if let Err(e) = h.set("video_ligado", novo) {
                            tracing::warn!("config: {e}");
                        }
                    }
                    tracing::info!("video: {}", if novo { "ligado" } else { "desligado" });
                    if !novo {
                        return self.trata_video(video::Estado::default());
                    }
                    Task::none()
                }
            },
            Message::Tique => {
                let ligado = self.config.video_ligado;
                let escolhida = self.video_escolhida;
                let montada = if self.video_montado.is_empty() { None } else { self.video_estado.aba };
                Task::batch(vec![
                    cosmic::task::future(async {
                        let (r, m) = tokio::join!(sistema::retrato(), musica::atual());
                        Message::RetratoMusica(Box::new(r), m)
                    }),
                    cosmic::task::future(async move { Message::Video(video::olhar(ligado, escolhida, montada).await) }),
                ])
            }
            Message::Video(e) => self.trata_video(e),
            Message::VideoUrls(id, resultado) => {
                self.video_buscando = false;
                // A assinatura leva a aba junto (`youtube:<id>@<aba>`): compara pelo começo,
                // senão toda URL vinda pela extensão era descartada calada.
                if !self.video_montado.starts_with(&format!("youtube:{id}")) {
                    tracing::info!("video: URL de {id} chegou depois de trocar de vídeo, descartada");
                    return Task::none();
                }
                match resultado {
                    Ok((v, a)) => {
                        let inicio = self.video_estado.posicao.unwrap_or(0).saturating_sub(1);
                        let volume = self.video_estado.volume;
                        match video::Player::tocar(&v, &a, inicio, volume, mirante::video::largura(self.config.video_escala) as u32) {
                            Ok(p) => {
                                self.video_player = Some(p);
                                self.volume_aplicado = volume;
                                let player = self.video_estado.player.clone();
                                let aba = self.video_estado.aba;
                                // A aba fica em silêncio enquanto a parede toca.
                                return cosmic::task::future(async move {
                                    video::pausa_navegador(player, aba).await;
                                    Message::Nada
                                });
                            }
                            Err(e) => tracing::warn!("video: player: {e}"),
                        }
                    }
                    Err(e) => tracing::warn!("video: {e}"),
                }
                Task::none()
            }
            Message::VideoQuadro => {
                if let Some(p) = &self.video_player {
                    if p.acabou() {
                        tracing::info!("video: acabou");
                        self.video_player = None;
                        return Task::none();
                    }
                    if let Some(q) = p.quadro() {
                        if let Some(v) = self.mirante.video.as_mut() {
                            v.quadro = Some(cosmic::widget::image::Handle::from_rgba(q.largura, q.altura, q.rgba));
                        }
                    }
                }
                Task::none()
            }
            Message::RetratoMusica(r, m) => {
                self.mirante.retrato = Some(*r);
                self.mirante.musica = m;
                // O próprio painel não conta como janela em foco.
                let janelas = crate::janelas::atual();
                self.mirante.janela_foco = janelas
                    .ativa()
                    .filter(|j| !j.app_id.eq_ignore_ascii_case(APP_ID))
                    .map(|j| j.titulo.clone());
                Task::none()
            }
            Message::TiqueLento => cosmic::task::future(async { Message::Pacotes(sistema::pacotes().await) }),
            Message::Pacotes(p) => {
                self.mirante.pacotes = p;
                Task::none()
            }
            Message::AgendaBuscar => {
                let url = self.config.agenda_ical.clone();
                let anterior = self.mirante.agenda.clone();
                cosmic::task::future(async move { Message::Agenda(agenda::buscar(url, anterior).await) })
            }
            Message::Agenda(a) => {
                self.mirante.poe_agenda(a);
                Task::none()
            }
            Message::JogoBuscar => {
                let anterior = self.mirante.jogo.clone();
                cosmic::task::future(async move { Message::Jogo(flamengo::buscar(anterior).await) })
            }
            Message::Jogo(j) => {
                self.mirante.jogo = j;
                Task::none()
            }
            Message::Nada => Task::none(),
        }
    }

    fn view(&self) -> Element<'_, Message> {
        unreachable!("sem janela principal")
    }

    fn view_window(&self, id: SurfaceId) -> Element<'_, Message> {
        if Some(id) == self.surface {
            let vidro = if std::env::var_os("RICEPANEL_SEM_VIDRO").is_some() {
                None
            } else {
                self.vidro.as_ref().map(|v| v.borrado.clone())
            };
            self.mirante.view(vidro).map(Message::Mirante)
        } else {
            cosmic::widget::Space::new().into()
        }
    }

    fn subscription(&self) -> Subscription<Message> {
        let mut subs = vec![
            listen_raw(|e, _status, id| match e {
                // Diagnóstico: `RICEPANEL_CURSOR=1` escreve no log onde o cursor está
                // sobre o painel. É o que calibra teste de clique automatizado.
                cosmic::iced::Event::Mouse(cosmic::iced::mouse::Event::CursorMoved { position })
                    if std::env::var_os("RICEPANEL_CURSOR").is_some() =>
                {
                    tracing::info!("cursor: {:.0},{:.0}", position.x, position.y);
                    None
                }
                cosmic::iced::Event::Mouse(cosmic::iced::mouse::Event::ButtonPressed(_))
                    if std::env::var_os("RICEPANEL_CURSOR").is_some() =>
                {
                    tracing::info!("cursor: clique");
                    None
                }
                cosmic::iced::Event::PlatformSpecific(PlatformSpecific::Wayland(wayland::Event::Output(ev, wl))) => {
                    Some(Message::Output(ev, wl))
                }
                cosmic::iced::Event::PlatformSpecific(PlatformSpecific::Wayland(wayland::Event::Layer(ev, _, _))) => {
                    Some(Message::Layer(ev, id))
                }
                _ => None,
            }),
            time::every(std::time::Duration::from_secs(1)).map(|_| Message::Segundo),
            time::every(std::time::Duration::from_secs(2)).map(|_| Message::Tique),
            // Só com vídeo tocando. 40 ms é o quadro do YouTube (25 fps): tique mais
            // rápido só redesenharia a página inteira com o mesmo quadro.
            if self.video_player.is_some() && !self.video_pausado {
                time::every(std::time::Duration::from_millis(40)).map(|_| Message::VideoQuadro)
            } else {
                Subscription::none()
            },
            time::every(std::time::Duration::from_secs(60)).map(|_| Message::TiqueLento),
            time::every(std::time::Duration::from_secs(15 * 60)).map(|_| Message::AgendaBuscar),
            time::every(flamengo::intervalo(&self.mirante.jogo)).map(|_| Message::JogoBuscar),
        ];
        if self.config_handle.is_some() {
            subs.push(
                self.core
                    .watch_config::<Config>(APP_ID)
                    .map(|u| Message::Config(u.config)),
            );
        }
        Subscription::batch(subs)
    }
}
