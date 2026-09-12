// Placa de vidro: o recipiente do Mirante. Raio 28, wallpaper desfocado atrás,
// um fio de luz na aresta de cima e nenhuma sombra projetada.
//
// Widget próprio porque o iced não tem backdrop: a placa recorta do vidro
// (`vidro.rs`) o retângulo exatamente atrás dela e desenha como imagem de
// cantos redondos. O recorte é refeito só quando a placa muda de lugar.

use std::cell::RefCell;
use std::sync::Arc;

use cosmic::iced::border::Radius;
use cosmic::iced::{Border, Color, Element, Length, Padding, Point, Rectangle, Size, Vector};
use cosmic::iced::core::image::{FilterMethod, Handle, Image, Renderer as _};
use cosmic::iced::core::layout::{self, Layout};
use cosmic::iced::core::mouse;
use cosmic::iced::core::overlay;
use cosmic::iced::core::renderer::{self, Quad, Renderer as _};
use cosmic::iced::core::widget::{Operation, Tree, tree};
use cosmic::iced::core::{Clipboard, Event, Shell, Widget};
use cosmic::iced::core::Radians;
use image::RgbaImage;

use crate::tema;

pub struct Placa<'a, M> {
    conteudo: Element<'a, M, cosmic::Theme, cosmic::Renderer>,
    vidro: Option<Arc<RgbaImage>>,
    padding: Padding,
    largura: Length,
    altura: Length,
    raio: f32,
    tinta: Color,
    // Gaze: a mesma placa sem aresta, com o vidro mais fraco. Um véu, não uma caixa.
    gaze: bool,
}

#[derive(Default)]
struct Estado {
    recorte: RefCell<Option<(Rectangle, Handle)>>,
}

pub fn placa<'a, M>(
    vidro: Option<Arc<RgbaImage>>,
    conteudo: impl Into<Element<'a, M, cosmic::Theme, cosmic::Renderer>>,
) -> Placa<'a, M> {
    Placa {
        conteudo: conteudo.into(),
        vidro,
        padding: Padding::new(18.0),
        largura: Length::Fill,
        altura: Length::Shrink,
        raio: tema::VIDRO_RAIO,
        tinta: tema::VIDRO_TINTA,
        gaze: false,
    }
}

impl<'a, M> Placa<'a, M> {
    pub fn padding(mut self, p: impl Into<Padding>) -> Self {
        self.padding = p.into();
        self
    }
    pub fn width(mut self, l: impl Into<Length>) -> Self {
        self.largura = l.into();
        self
    }
    pub fn height(mut self, l: impl Into<Length>) -> Self {
        self.altura = l.into();
        self
    }
    pub fn raio(mut self, r: f32) -> Self {
        self.raio = r;
        self
    }
    pub fn tinta(mut self, c: Color) -> Self {
        self.tinta = c;
        self
    }
    pub fn gaze(mut self) -> Self {
        self.gaze = true;
        self.tinta = Color { a: 0.42, ..tema::VIDRO_TINTA };
        self
    }
}

// O recorte sai do vidro com o canto já redondo e, na gaze, com a queda
// radial: o `border_radius` da imagem não é honrado pelo pipeline daqui, e a
// máscara no alfa custa uma passada por pixel só quando a placa muda de lugar.
fn recortar(vidro: &RgbaImage, b: Rectangle, raio: f32, gaze: bool) -> Option<Handle> {
    let x = b.x.round().max(0.0) as u32;
    let y = b.y.round().max(0.0) as u32;
    if x >= vidro.width() || y >= vidro.height() {
        return None;
    }
    let w = (b.width.round() as u32).min(vidro.width() - x).max(1);
    let h = (b.height.round() as u32).min(vidro.height() - y).max(1);
    let mut sub = image::imageops::crop_imm(vidro, x, y, w, h).to_image();
    let r = raio.min(w as f32 / 2.0).min(h as f32 / 2.0);
    let (fw, fh) = (w as f32, h as f32);
    for (px, py, p) in sub.enumerate_pixels_mut() {
        let (cx, cy) = (px as f32 + 0.5, py as f32 + 0.5);
        let mut alfa = 1.0f32;
        if gaze {
            // Elipse estreita e de queda longa: sem borda, sem canto, sem onde começar.
            let nx = (cx - fw / 2.0) / (fw / 2.0);
            let ny = (cy - fh / 2.0) / (fh / 2.0);
            let d = (nx * nx * 0.55 + ny * ny).sqrt();
            alfa = (1.0 - ((d - 0.35) / 0.65).clamp(0.0, 1.0)).powf(1.4);
        } else if r > 0.0 {
            // Distância assinada até o retângulo arredondado, suavizada em 1px.
            let qx = (cx - fw / 2.0).abs() - (fw / 2.0 - r);
            let qy = (cy - fh / 2.0).abs() - (fh / 2.0 - r);
            let dist = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - r;
            alfa = (0.5 - dist).clamp(0.0, 1.0);
        }
        if gaze {
            // A tinta da gaze vai no próprio pixel: 45% em direção ao mantle.
            for (i, alvo) in [24.0f32, 24.0, 37.0].iter().enumerate() {
                p.0[i] = (p.0[i] as f32 * 0.55 + alvo * 0.45).round() as u8;
            }
        }
        p.0[3] = (p.0[3] as f32 * alfa).round() as u8;
    }
    Some(Handle::from_rgba(w, h, sub.into_raw()))
}

impl<'a, M> Widget<M, cosmic::Theme, cosmic::Renderer> for Placa<'a, M> {
    fn tag(&self) -> tree::Tag {
        tree::Tag::of::<Estado>()
    }

    fn state(&self) -> tree::State {
        tree::State::new(Estado::default())
    }

    fn children(&self) -> Vec<Tree> {
        vec![Tree::new(&self.conteudo)]
    }

    fn diff(&mut self, tree: &mut Tree) {
        tree.diff_children(std::slice::from_mut(&mut self.conteudo));
    }

    fn size(&self) -> Size<Length> {
        Size::new(self.largura, self.altura)
    }

    fn layout(&mut self, tree: &mut Tree, renderer: &cosmic::Renderer, limits: &layout::Limits) -> layout::Node {
        layout::padded(limits, self.largura, self.altura, self.padding, |limits| {
            self.conteudo.as_widget_mut().layout(&mut tree.children[0], renderer, limits)
        })
    }

    fn update(
        &mut self,
        tree: &mut Tree,
        event: &Event,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &cosmic::Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, M>,
        viewport: &Rectangle,
    ) {
        self.conteudo.as_widget_mut().update(
            &mut tree.children[0],
            event,
            layout.children().next().unwrap(),
            cursor,
            renderer,
            clipboard,
            shell,
            viewport,
        );
    }

    fn mouse_interaction(
        &self,
        tree: &Tree,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
        renderer: &cosmic::Renderer,
    ) -> mouse::Interaction {
        self.conteudo.as_widget().mouse_interaction(
            &tree.children[0],
            layout.children().next().unwrap(),
            cursor,
            viewport,
            renderer,
        )
    }

    fn operate(&mut self, tree: &mut Tree, layout: Layout<'_>, renderer: &cosmic::Renderer, operation: &mut dyn Operation) {
        self.conteudo.as_widget_mut().operate(
            &mut tree.children[0],
            layout.children().next().unwrap(),
            renderer,
            operation,
        );
    }

    fn overlay<'b>(
        &'b mut self,
        tree: &'b mut Tree,
        layout: Layout<'b>,
        renderer: &cosmic::Renderer,
        viewport: &Rectangle,
        translation: Vector,
    ) -> Option<overlay::Element<'b, M, cosmic::Theme, cosmic::Renderer>> {
        self.conteudo.as_widget_mut().overlay(
            &mut tree.children[0],
            layout.children().next().unwrap(),
            renderer,
            viewport,
            translation,
        )
    }

    fn draw(
        &self,
        tree: &Tree,
        renderer: &mut cosmic::Renderer,
        theme: &cosmic::Theme,
        style: &renderer::Style,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
    ) {
        let bounds = layout.bounds();
        let raio = Radius::from(self.raio);

        if let Some(vidro) = &self.vidro {
            let estado = tree.state.downcast_ref::<Estado>();
            let mut cache = estado.recorte.borrow_mut();
            let precisa = match &*cache {
                Some((b, _)) => *b != bounds,
                None => true,
            };
            if precisa {
                *cache = recortar(vidro, bounds, self.raio, self.gaze).map(|h| (bounds, h));
            }
            if let Some((_, handle)) = &*cache {
                renderer.draw_image(
                    Image {
                        handle: handle.clone(),
                        filter_method: FilterMethod::Linear,
                        rotation: Radians(0.0),
                        border_radius: raio,
                        opacity: 1.0,
                        snap: false,
                    },
                    bounds,
                    *viewport,
                );
            }
        }

        // O iced_wgpu desenha, dentro de uma camada, primeiro os quads, depois
        // as malhas (canvas), depois as imagens e por fim o texto. O vidro é
        // imagem: se tinta e filhos ficassem na mesma camada, os trilhos, anéis
        // e fundos deles sumiriam por baixo dele. A camada aninhada renderiza
        // depois da camada de fora, então tudo o que vem por cima do vidro
        // entra nela.
        let raio_gaze = self.raio;
        let gaze = self.gaze;
        let tinta = self.tinta;
        let filho = &self.conteudo;
        let arvore = &tree.children[0];
        let layout_filho = layout.children().next().unwrap();
        renderer.with_layer(bounds, |renderer| {
            if !gaze {
                renderer.fill_quad(
                    Quad {
                        bounds,
                        border: Border { radius: raio, width: 1.0, color: tema::VIDRO_ARESTA },
                        ..Quad::default()
                    },
                    tinta,
                );
            }
            if !gaze {
                // O fio de luz na aresta de cima: um traço claro, dentro do raio.
                let fio = Rectangle {
                    x: bounds.x + raio_gaze,
                    y: bounds.y + 1.0,
                    width: (bounds.width - 2.0 * raio_gaze).max(0.0),
                    height: 1.0,
                };
                renderer.fill_quad(Quad { bounds: fio, ..Quad::default() }, Color { a: 0.22, ..tema::TEXT });
            }
            filho.as_widget().draw(arvore, renderer, theme, style, layout_filho, cursor, viewport);
        });
    }
}

impl<'a, M: 'a> From<Placa<'a, M>> for Element<'a, M, cosmic::Theme, cosmic::Renderer> {
    fn from(p: Placa<'a, M>) -> Self {
        Element::new(p)
    }
}

#[allow(dead_code)]
pub fn ponto_zero() -> Point {
    Point::ORIGIN
}
