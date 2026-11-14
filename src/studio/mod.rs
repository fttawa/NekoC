//! Native editor document and host layer. Neither requires a JavaScript engine.
pub mod document;
pub mod overlay;
#[cfg(not(target_arch = "wasm32"))]
pub mod player;

#[cfg(feature = "studio")]
pub mod app;

#[cfg(feature = "studio")]
mod renderer;

#[cfg(feature = "studio")]
mod overlay_renderer;
