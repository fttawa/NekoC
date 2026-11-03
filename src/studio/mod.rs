//! Native editor document and host layer. Neither requires a JavaScript engine.
pub mod document;
pub mod player;

#[cfg(feature = "studio")]
pub mod app;
