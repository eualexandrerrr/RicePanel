// RicePanel, nativo do COSMIC.
//
// Reescrita em Rust do painel Electron que mora um diretório acima. A casca é
// uma layer surface (wlr-layer-shell) na camada de baixo do monitor em pé:
// acima do papel de parede, abaixo das janelas, fora da barra de tarefas. Não
// há regra de janela, vigia de posição nem `skipTaskbar`: é o compositor que
// sabe onde o painel mora, como manda o Wayland.

mod agenda;
mod app;
mod flamengo;
mod janelas;
mod musica;
mod ponte;
mod sistema;
mod widgets;
mod config;
mod mirante;
mod placa;
mod tema;
mod video;
mod vidro;
mod volume_chrome;

fn main() -> cosmic::iced::Result {
    // Chamado pelo Chrome como host de native messaging: sem interface.
    if ponte::eh_chamada_do_chrome() {
        ponte::rodar();
        return Ok(());
    }
    init_log();
    tracing::info!("ricepanel {}", env!("CARGO_PKG_VERSION"));
    tema::instalar_fontes();
    janelas::iniciar();
    app::run()
}

fn init_log() {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::{EnvFilter, fmt};

    let filtro = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,ricepanel=info"));
    let registro = tracing_subscriber::registry().with(filtro);
    // No systemd o log vai para o journal; no terminal, para a saída.
    if let Ok(journal) = tracing_journald::layer() {
        registro.with(journal).init();
    } else {
        registro.with(fmt::layer().with_target(false)).init();
    }
}
