// Trilho de medidor: poço escuro de 7px, raio total, e o preenchimento na cor
// da escala. Widget mínimo: dois `fill_quad`, nada de layout.

use cosmic::iced::border::Radius;
use cosmic::iced::{Border, Color, Element, Length, Rectangle, Size};
use cosmic::iced::core::layout::{self, Layout};
use cosmic::iced::core::renderer::{self, Quad, Renderer as _};
use cosmic::iced::core::widget::Tree;
use cosmic::iced::core::{Widget, mouse};

pub struct Trilho {
    fracao: f32,
    cor: Color,
    altura: f32,
    largura: Length,
}

pub fn trilho(fracao: f32, cor: Color) -> Trilho {
    Trilho { fracao: fracao.clamp(0.0, 1.0), cor, altura: 7.0, largura: Length::Fill }
}

impl Trilho {
    pub fn altura(mut self, a: f32) -> Self {
        self.altura = a;
        self
    }
    pub fn width(mut self, l: impl Into<Length>) -> Self {
        self.largura = l.into();
        self
    }
}

impl<M> Widget<M, cosmic::Theme, cosmic::Renderer> for Trilho {
    fn size(&self) -> Size<Length> {
        Size::new(self.largura, Length::Fixed(self.altura))
    }

    fn layout(&mut self, _tree: &mut Tree, _renderer: &cosmic::Renderer, limits: &layout::Limits) -> layout::Node {
        let size = limits.resolve(self.largura, Length::Fixed(self.altura), Size::ZERO);
        layout::Node::new(size)
    }

    fn draw(
        &self,
        _tree: &Tree,
        renderer: &mut cosmic::Renderer,
        _theme: &cosmic::Theme,
        _style: &renderer::Style,
        layout: Layout<'_>,
        _cursor: mouse::Cursor,
        _viewport: &Rectangle,
    ) {
        let b = layout.bounds();
        let raio = Radius::from(b.height / 2.0);
        renderer.fill_quad(
            Quad { bounds: b, border: Border { radius: raio, ..Default::default() }, ..Quad::default() },
            Color { r: 17.0 / 255.0, g: 17.0 / 255.0, b: 27.0 / 255.0, a: 0.55 },
        );
        let w = b.width * self.fracao;
        if w >= 1.0 {
            renderer.fill_quad(
                Quad {
                    bounds: Rectangle { width: w.max(b.height), ..b },
                    border: Border { radius: raio, ..Default::default() },
                    ..Quad::default()
                },
                self.cor,
            );
        }
    }
}

impl<'a, M: 'a> From<Trilho> for Element<'a, M, cosmic::Theme, cosmic::Renderer> {
    fn from(t: Trilho) -> Self {
        Element::new(t)
    }
}
