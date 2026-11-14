//! wasm-bindgen surface of NekoC for `@nekox-lab/nekoc`. All values cross the
//! boundary as JSON text; the JS side owns the TypeScript frontend.
use nekoc::{bcmkn_compiler, check, json, player, validate as structure};
use wasm_bindgen::prelude::*;

fn error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn to_text(value: &impl serde::Serialize) -> Result<String, JsValue> {
    String::from_utf8(json::to_vec(value).map_err(error)?).map_err(error)
}

/// `{project, report}` for a Kitten N `.bcmkn` or Kitten 4 `.bcm` text.
#[wasm_bindgen(js_name = importProject)]
pub fn import_project(text: &str) -> Result<String, JsValue> {
    let (project, report) = player::import(json::from_str(text).map_err(error)?).map_err(error)?;
    to_text(&serde_json::json!({ "project": project, "report": report }))
}

/// Assembles the frontend's workspace report into a `.bcmkn` project. Without
/// a template the bundled empty work is used, as in `nekoc build`.
#[wasm_bindgen(js_name = assembleBcmkn)]
pub fn assemble_bcmkn(
    report: &str,
    name: &str,
    template: Option<String>,
) -> Result<String, JsValue> {
    let report = json::from_str(report).map_err(error)?;
    let template = match template {
        Some(text) => json::from_str(&text).map_err(error)?,
        None => bcmkn_compiler::default_template(),
    };
    let project =
        bcmkn_compiler::assemble_workspace_bcmkn(&report, name, template).map_err(error)?;
    to_text(&project)
}

/// Structural diagnostics (`source: "project"`) in the same shape as
/// `nekoc check --json`.
#[wasm_bindgen(js_name = projectDiagnostics)]
pub fn project_diagnostics(text: &str, file: Option<String>) -> Result<String, JsValue> {
    let project = json::from_str(text).map_err(error)?;
    let diagnostics = check::project_diagnostics(&project, file.as_deref()).map_err(error)?;
    serde_json::to_string(&diagnostics).map_err(error)
}

/// `{ok, stats}` when `{project, extensions}` compiles with those remote
/// extension blocks (the player's `/api/extension-check`).
#[wasm_bindgen(js_name = checkExtensions)]
pub fn check_extensions(text: &str) -> Result<String, JsValue> {
    let payload = json::from_str(text).map_err(error)?;
    to_text(&player::check_extensions(&payload).map_err(error)?)
}

/// The full `nekoc validate` report.
#[wasm_bindgen]
pub fn validate(text: &str) -> Result<String, JsValue> {
    let project = json::from_str(text).map_err(error)?;
    let report = structure::build_report(&project).map_err(error)?;
    Ok(report.to_string())
}

/// The player backend (`nekoc::player`): send the same handshake and frame
/// requests as the WebSocket transport, get text or binary frames back.
#[wasm_bindgen]
pub struct Player(player::Player);

#[wasm_bindgen]
impl Player {
    #[wasm_bindgen(constructor)]
    pub fn new(handshake: &str) -> Result<Player, JsValue> {
        let handshake = player::Handshake::parse(handshake).map_err(error)?;
        Ok(Self(player::Player::load(handshake).map_err(error)?))
    }

    pub fn ready(&self) -> String {
        self.0.ready().to_string()
    }

    pub fn handle(&mut self, text: &str) -> Result<JsValue, JsValue> {
        match self.0.handle(text).map_err(error)? {
            player::Reply::Text(text) => Ok(JsValue::from_str(&text)),
            player::Reply::Binary(bytes) => Ok(js_sys::Uint8Array::from(bytes.as_slice()).into()),
        }
    }
}
