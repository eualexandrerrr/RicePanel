// Janelas do compositor: qual está ativa, quais estão à vista.
//
// Substitui o `hyprctl` do painel antigo. No COSMIC não há CLI para isso: é o
// protocolo `ext-foreign-toplevel-list` (título, app_id, estado) com o
// `ext-workspace` (qual workspace está ativo em cada saída), pelo cctk que o
// próprio libcosmic reexporta. Uma thread mantém a conexão e escreve o retrato
// num `Mutex`; o app lê no tique de 2 s.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use cosmic::cctk::sctk::output::{OutputHandler, OutputState};
use cosmic::cctk::sctk::reexports::calloop;
use cosmic::cctk::sctk::reexports::calloop_wayland_source::WaylandSource;
use cosmic::cctk::sctk::registry::{ProvidesRegistryState, RegistryState};
use cosmic::cctk::sctk::{self, registry_handlers};
use cosmic::cctk::toplevel_info::{ToplevelInfoHandler, ToplevelInfoState};
use cosmic::cctk::wayland_client::globals::registry_queue_init;
use cosmic::cctk::wayland_client::protocol::wl_output;
use cosmic::cctk::wayland_client::{Connection, QueueHandle};
use cosmic::cctk::wayland_protocols::ext::foreign_toplevel_list::v1::client::ext_foreign_toplevel_handle_v1::ExtForeignToplevelHandleV1;
use cosmic::cctk::wayland_protocols::ext::workspace::v1::client::ext_workspace_handle_v1::{ExtWorkspaceHandleV1, State as EstadoWs};
use cosmic::cctk::workspace::{WorkspaceHandler, WorkspaceState};
use cosmic::cctk::{self, cosmic_protocols::toplevel_info::v1::client::zcosmic_toplevel_handle_v1::State as EstadoJanela};

#[derive(Debug, Clone, Default)]
pub struct Janela {
    pub titulo: String,
    pub app_id: String,
    pub ativa: bool,
    /// Está num workspace ativo de alguma saída: ele consegue vê-la agora.
    pub a_vista: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Retrato {
    pub janelas: Vec<Janela>,
}

impl Retrato {
    pub fn ativa(&self) -> Option<&Janela> {
        self.janelas.iter().find(|j| j.ativa)
    }
}

static RETRATO: OnceLock<Mutex<Retrato>> = OnceLock::new();

pub fn atual() -> Retrato {
    RETRATO.get().and_then(|m| m.lock().ok()).map(|g| g.clone()).unwrap_or_default()
}

struct Dados {
    output_state: OutputState,
    workspace_state: WorkspaceState,
    toplevel_info_state: ToplevelInfoState,
    registry_state: RegistryState,
    ativos: HashSet<ExtWorkspaceHandleV1>,
}

impl Dados {
    fn publica(&mut self) {
        let janelas = self
            .toplevel_info_state
            .toplevels()
            .map(|t| Janela {
                titulo: t.title.clone(),
                app_id: t.app_id.clone(),
                ativa: t.state.contains(&EstadoJanela::Activated),
                a_vista: t.workspace.iter().any(|w| self.ativos.contains(w))
                    && !t.state.contains(&EstadoJanela::Minimized),
            })
            .collect();
        if let Some(m) = RETRATO.get() {
            if let Ok(mut g) = m.lock() {
                g.janelas = janelas;
            }
        }
    }
}

impl OutputHandler for Dados {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }
    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl WorkspaceHandler for Dados {
    fn workspace_state(&mut self) -> &mut WorkspaceState {
        &mut self.workspace_state
    }
    fn done(&mut self) {
        let mut ativos = HashSet::new();
        for grupo in self.workspace_state.workspace_groups() {
            for h in &grupo.workspaces {
                if let Some(w) = self.workspace_state.workspace_info(h) {
                    if w.state.contains(EstadoWs::Active) {
                        ativos.insert(w.handle.clone());
                    }
                }
            }
        }
        self.ativos = ativos;
        self.publica();
    }
}

impl ToplevelInfoHandler for Dados {
    fn toplevel_info_state(&mut self) -> &mut ToplevelInfoState {
        &mut self.toplevel_info_state
    }
    fn new_toplevel(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &ExtForeignToplevelHandleV1) {
        self.publica();
    }
    fn update_toplevel(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &ExtForeignToplevelHandleV1) {
        self.publica();
    }
    fn toplevel_closed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &ExtForeignToplevelHandleV1) {
        self.publica();
    }
}

impl ProvidesRegistryState for Dados {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers!();
}

sctk::delegate_registry!(Dados);
sctk::delegate_output!(Dados);
cctk::delegate_toplevel_info!(Dados);
cctk::delegate_workspace!(Dados);

fn laco() -> Result<(), String> {
    let conn = Connection::connect_to_env().map_err(|e| e.to_string())?;
    let (globals, event_queue) = registry_queue_init(&conn).map_err(|e| e.to_string())?;
    let qh = event_queue.handle();
    let mut event_loop = calloop::EventLoop::<Dados>::try_new().map_err(|e| e.to_string())?;
    WaylandSource::new(conn.clone(), event_queue)
        .insert(event_loop.handle())
        .map_err(|e| e.to_string())?;
    let registry_state = RegistryState::new(&globals);
    let mut dados = Dados {
        output_state: OutputState::new(&globals, &qh),
        workspace_state: WorkspaceState::new(&registry_state, &qh),
        toplevel_info_state: ToplevelInfoState::new(&registry_state, &qh),
        registry_state,
        ativos: HashSet::new(),
    };
    loop {
        event_loop.dispatch(None, &mut dados).map_err(|e| e.to_string())?;
    }
}

pub fn iniciar() {
    let _ = RETRATO.set(Mutex::new(Retrato::default()));
    std::thread::Builder::new()
        .name("janelas".into())
        .spawn(|| {
            if let Err(e) = laco() {
                tracing::warn!("janelas: {e}");
            }
        })
        .ok();
}
