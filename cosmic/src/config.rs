// Ajustes do painel, pelo cosmic-config: `~/.config/cosmic/br.com.eualexandre.RicePanel/v1/<chave>`.
// Hot reload de graça e o mesmo lugar onde o resto do desktop guarda ajuste.

use cosmic::cosmic_config::{self, CosmicConfigEntry, cosmic_config_derive::CosmicConfigEntry};
use serde::{Deserialize, Serialize};

pub const APP_ID: &str = "br.com.eualexandre.RicePanel";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, CosmicConfigEntry)]
#[version = 1]
pub struct Config {
    /// Nome do output (como no `cosmic-randr list`) onde o painel mora.
    pub saida: String,
    /// Vídeo do navegador na parede. Nasce desligado: puxar o vídeo pausa a aba.
    pub video_ligado: bool,
    /// Endereço secreto iCal do Google Calendar. Vazio = agenda desligada.
    pub agenda_ical: String,
    /// Tamanho da placa de vídeo: 1.0 é a largura da coluna (620 px).
    pub video_escala: f32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            saida: "DP-1".into(),
            video_ligado: false,
            agenda_ical: String::new(),
            video_escala: 1.0,
        }
    }
}

impl Config {
    pub fn carregar() -> (Self, Option<cosmic_config::Config>) {
        match cosmic_config::Config::new(APP_ID, Self::VERSION) {
            Ok(handle) => {
                let cfg = Self::get_entry(&handle).unwrap_or_else(|(erros, cfg)| {
                    for e in erros {
                        tracing::warn!("config: {e}");
                    }
                    cfg
                });
                (cfg, Some(handle))
            }
            Err(e) => {
                tracing::warn!("config indisponível: {e}");
                (Self::default(), None)
            }
        }
    }
}
