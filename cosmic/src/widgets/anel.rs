// Anel térmico: trilho fraco, arco na cor da escala (traço de 3px, ponta
// redonda), número no meio em Archivo 300 e o grau sobrescrito como unidade.

use cosmic::iced::alignment::{Horizontal, Vertical};
use cosmic::iced::font::Weight;
use cosmic::iced::widget::canvas::{self, Path, Stroke, stroke};
use cosmic::iced::{Color, Element, Length, Pixels, Point, Rectangle, Vector, mouse};

use crate::tema;

pub struct Anel {
    pub temp: Option<i32>,
}

pub const TEMP_MIN: f32 = 30.0;
pub const TEMP_MAX: f32 = 100.0;

impl<M> canvas::Program<M, cosmic::Theme, cosmic::Renderer> for Anel {
    type State = ();

    fn draw(
        &self,
        _state: &(),
        renderer: &cosmic::Renderer,
        _theme: &cosmic::Theme,
        bounds: Rectangle,
        _cursor: mouse::Cursor,
    ) -> Vec<canvas::Geometry<cosmic::Renderer>> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());
        let centro = Point::new(bounds.width / 2.0, bounds.height / 2.0);
        let raio = bounds.width.min(bounds.height) / 2.0 - 3.0;

        frame.stroke(
            &Path::circle(centro, raio),
            Stroke::default().with_width(3.0).with_color(Color { a: 0.10, ..tema::TEXT }),
        );

        let (numero, cor) = match self.temp {
            Some(t) => {
                let f = ((t as f32 - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)).clamp(0.0, 1.0);
                if f > 0.0 {
                    let ini = -std::f32::consts::FRAC_PI_2;
                    let arco = Path::new(|b| {
                        b.arc(canvas::path::Arc {
                            center: centro,
                            radius: raio,
                            start_angle: ini.into(),
                            end_angle: (ini + f * std::f32::consts::TAU).into(),
                        });
                    });
                    frame.stroke(
                        &arco,
                        Stroke {
                            line_cap: stroke::LineCap::Round,
                            ..Stroke::default().with_width(3.0).with_color(tema::cor_termica(t as f32))
                        },
                    );
                }
                (t.to_string(), tema::LEITURA)
            }
            None => ("--".into(), tema::OVERLAY0),
        };

        frame.fill_text(canvas::Text {
            content: numero,
            position: centro + Vector::new(-5.0, 1.0),
            color: cor,
            size: Pixels(27.0),
            font: tema::archivo(Weight::Light),
            align_x: Horizontal::Center.into(),
            align_y: Vertical::Center,
            ..canvas::Text::default()
        });
        frame.fill_text(canvas::Text {
            content: "°C".into(),
            position: centro + Vector::new(12.0, -7.0),
            color: tema::SERIGRAFIA,
            size: Pixels(12.5),
            font: tema::archivo(Weight::Normal),
            align_x: Horizontal::Left.into(),
            align_y: Vertical::Center,
            ..canvas::Text::default()
        });
        vec![frame.into_geometry()]
    }
}

pub fn anel<'a, M: 'a>(temp: Option<i32>) -> Element<'a, M, cosmic::Theme, cosmic::Renderer> {
    canvas::Canvas::new(Anel { temp })
        .width(Length::Fixed(76.0))
        .height(Length::Fixed(76.0))
        .into()
}

// O "calmo" do vazio da agenda: um aro que diz "está tudo bem, não há nada".
pub struct Calmo;

impl<M> canvas::Program<M, cosmic::Theme, cosmic::Renderer> for Calmo {
    type State = ();
    fn draw(
        &self,
        _state: &(),
        renderer: &cosmic::Renderer,
        _theme: &cosmic::Theme,
        bounds: Rectangle,
        _cursor: mouse::Cursor,
    ) -> Vec<canvas::Geometry<cosmic::Renderer>> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());
        let centro = Point::new(bounds.width / 2.0, bounds.height / 2.0);
        let r = bounds.width.min(bounds.height) / 2.0 - 4.0;
        frame.stroke(&Path::circle(centro, r), Stroke::default().with_width(2.0).with_color(Color { a: 0.35, ..tema::ACENTO }));
        frame.stroke(&Path::circle(centro, r * 0.62), Stroke::default().with_width(1.5).with_color(Color { a: 0.22, ..tema::ACENTO }));
        frame.fill(&Path::circle(centro, r * 0.16), Color { a: 0.8, ..tema::ACENTO });
        vec![frame.into_geometry()]
    }
}

pub fn calmo<'a, M: 'a>() -> Element<'a, M, cosmic::Theme, cosmic::Renderer> {
    canvas::Canvas::new(Calmo).width(Length::Fixed(66.0)).height(Length::Fixed(66.0)).into()
}
