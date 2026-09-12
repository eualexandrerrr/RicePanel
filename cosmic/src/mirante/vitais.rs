// Vitais da máquina: térmica em cima (um anel por peça), carga embaixo
// (rótulo e valor na mesma linha, trilho curto), rede no pé.

use cosmic::Element;
use cosmic::iced::font::Weight;
use cosmic::iced::{Alignment, ContentFit, Length};
use cosmic::widget::{Column, Row, container, image};

use super::ui;
use super::{Message, Mirante};
use crate::sistema::{self, Gpu, Retrato};
use crate::tema;
use crate::widgets::anel::anel;
use crate::widgets::trilho::trilho;

const FOTO_CPU: &[u8] = include_bytes!("../../../fotos/cpu-ryzen.png");
const FOTO_NVIDIA: &[u8] = include_bytes!("../../../fotos/gpu-nvidia.png");
const FOTO_AMD: &[u8] = include_bytes!("../../../fotos/gpu-amd.png");
const FOTO_NVME: &[u8] = include_bytes!("../../../fotos/ssd-nvme.png");

fn foto<'a>(bytes: &'static [u8]) -> Element<'a, Message> {
    image(image::Handle::from_bytes(bytes))
        .width(Length::Fixed(96.0))
        .height(Length::Fixed(42.0))
        .content_fit(ContentFit::Contain)
        .into()
}

fn fmt_vram(mib: u64) -> String {
    let gb = mib as f64 / 1024.0;
    if gb >= 10.0 { format!("{:.0}", gb) } else { format!("{:.1}", gb).replace('.', ",") }
}

fn dados_gpu(g: &Gpu) -> String {
    let uso = match g.uso {
        Some(u) => format!("{u}%"),
        None if g.na_vm => "no vfio".into(),
        None => "—".into(),
    };
    match (g.vram_usada_mib, g.vram_total_mib) {
        (Some(u), Some(t)) => format!("{uso} · {}/{} GB", fmt_vram(u), fmt_vram(t)),
        _ => uso,
    }
}

fn sensor<'a>(rotulo: String, temp: Option<i32>, foto_bytes: Option<&'static [u8]>, dados: String) -> Element<'a, Message> {
    let mut c = Column::new().push(anel(temp)).spacing(6).align_x(Alignment::Center);
    if let Some(b) = foto_bytes {
        c = c.push(foto(b));
    }
    c = c.push(ui::rotulo(&rotulo)).push(ui::texto(dados, 12.5, Weight::Normal, tema::SUBTEXT1));
    container(c).width(Length::Fill).center_x(Length::Fill).into()
}

fn medidor<'a>(rotulo: &str, pct: Option<u8>, valor: String) -> Element<'a, Message> {
    let f = pct.map(|p| p as f32 / 100.0).unwrap_or(0.0);
    let cor = pct.map(|p| tema::cor_carga(p as f32)).unwrap_or(tema::OVERLAY0);
    Column::new()
        .push(
            Row::new()
                .push(ui::rotulo(rotulo))
                .push(cosmic::widget::Space::new().width(Length::Fill))
                .push(ui::leitura(valor, 15.0))
                .align_y(Alignment::End)
                .spacing(8),
        )
        .push(trilho(f, cor))
        .spacing(5)
        .width(Length::Fill)
        .into()
}

pub fn view<'a>(m: &'a Mirante) -> Element<'a, Message> {
    let r: Option<&Retrato> = m.retrato.as_ref();

    // Anéis: CPU, uma por placa de vídeo, SSD.
    let mut aneis = Row::new().spacing(0);
    let cpu_dados = r
        .map(|r| {
            let mut p = vec![r.cpu.pct.map(|v| format!("{v}%")).unwrap_or_else(|| "—".into())];
            if let Some(g) = r.cpu.ghz {
                p.push(format!("{:.1} GHz", g).replace('.', ","));
            }
            p.join(" · ")
        })
        .unwrap_or_default();
    let cpu_ryzen = r.map(|r| r.cpu.modelo.to_ascii_lowercase().contains("ryzen")).unwrap_or(true);
    aneis = aneis.push(sensor("CPU".into(), r.and_then(|r| r.cpu.temp), cpu_ryzen.then_some(FOTO_CPU), cpu_dados));
    match r {
        Some(r) if !r.gpus.is_empty() => {
            let quantas = r.gpus.len();
            for (i, g) in r.gpus.iter().enumerate() {
                let nome = if quantas < 2 { "GPU".to_string() } else if g.nome.is_empty() { format!("GPU {}", i + 1) } else { g.nome.clone() };
                let f = if g.marca.eq_ignore_ascii_case("nvidia") { Some(FOTO_NVIDIA) } else { Some(FOTO_AMD) };
                aneis = aneis.push(sensor(nome, g.temp, f, dados_gpu(g)));
            }
        }
        _ => aneis = aneis.push(sensor("GPU".into(), None, None, String::new())),
    }
    let nvme_nome = r.map(|r| if r.nvme_modelo.is_empty() { "SSD".to_string() } else { r.nvme_modelo.clone() }).unwrap_or("SSD".into());
    aneis = aneis.push(sensor(nvme_nome, r.and_then(|r| r.nvme_temp), Some(FOTO_NVME), String::new()));

    // Medidores de carga: CPU, RAM, discos, swap quando passa de 256 MB.
    let mut meds: Vec<Element<'a, Message>> = vec![];
    if let Some(r) = r {
        meds.push(medidor("CPU", r.cpu.pct, r.cpu.pct.map(|p| format!("{p}%")).unwrap_or_else(|| "—".into())));
        if let Some(mem) = &r.memoria {
            meds.push(medidor("RAM", Some(mem.pct), format!("{} / {}", sistema::fmt_gb(mem.usada), sistema::fmt_gb(mem.total))));
        }
        for d in &r.discos {
            meds.push(medidor(if d.ponto == "/" { "Root" } else { "Home" }, Some(d.pct), format!("{} / {}", sistema::fmt_gb(d.usado), sistema::fmt_gb(d.total))));
        }
        if let Some(mem) = &r.memoria {
            if mem.swap_total > 0 && mem.swap_usado > 256 * 1_048_576 {
                let pct = ((mem.swap_usado as f64 / mem.swap_total as f64) * 100.0).round() as u8;
                meds.push(medidor("Swap", Some(pct), sistema::fmt_gb(mem.swap_usado)));
            }
        }
    } else {
        meds.push(medidor("CPU", None, "—".into()));
        meds.push(medidor("RAM", None, "—".into()));
    }
    let mut grade = Column::new().spacing(9);
    let mut fila = Row::new().spacing(18);
    let mut n = 0;
    for m in meds {
        fila = fila.push(m);
        n += 1;
        if n == 3 {
            grade = grade.push(fila);
            fila = Row::new().spacing(18);
            n = 0;
        }
    }
    if n > 0 {
        while n < 3 {
            fila = fila.push(cosmic::widget::Space::new().width(Length::Fill));
            n += 1;
        }
        grade = grade.push(fila);
    }

    let rede = r.map(|r| &r.rede);
    let linha_rede = Row::new()
        .push(ui::rotulo("Baixando"))
        .push(ui::leitura(sistema::fmt_taxa(rede.and_then(|x| x.rx_bps)), 15.0))
        .push(cosmic::widget::Space::new().width(Length::Fixed(20.0)))
        .push(ui::rotulo("Subindo"))
        .push(ui::leitura(sistema::fmt_taxa(rede.and_then(|x| x.tx_bps)), 15.0))
        .push(cosmic::widget::Space::new().width(Length::Fixed(20.0)))
        .push(ui::rotulo(rede.map(|x| x.iface.as_str()).unwrap_or("")))
        .spacing(7)
        .align_y(Alignment::End);

    Column::new()
        .push(container(aneis).padding([12, 14, 8, 14]))
        .push(container(ui::regua(Length::Fill)).padding([0, 20]))
        .push(container(grade).padding([10, 14, 6, 14]))
        .push(container(linha_rede).padding([2, 16, 11, 16]).width(Length::Fill).center_x(Length::Fill))
        .width(Length::Fill)
        .into()
}
