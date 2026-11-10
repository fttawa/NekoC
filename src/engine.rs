//! Precompiled numeric/pen VM for the Web player.
//! JSON is read only by the compiler. Execution uses indexed slots and instructions.
//! Unsupported blocks are compile errors, never silently treated as no-ops.
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use serde_json::Value;
mod calculate;
mod cloud;
mod jit;
mod kn_helpers;
mod physics;
mod value;
use std::{cell::RefCell, rc::Rc};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    time::{Duration, Instant},
};
pub use value::Cell;
use value::{List, ListRef, Span, Target, ValueExpr};

#[derive(Clone, Copy, Debug)]
enum Binary {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or,
    Divisible,
}
impl Binary {
    fn apply(self, a: f64, b: f64) -> f64 {
        match self {
            Self::Add => a + b,
            Self::Sub => a - b,
            Self::Mul => a * b,
            // Official K4 Tn6a/h and KN operators propagate IEEE nonfinite values.
            Self::Div => a / b,
            Self::Mod => a % b,
            Self::Pow => a.powf(b),
            Self::Eq => (a == b) as u8 as f64,
            Self::Ne => (a != b) as u8 as f64,
            Self::Lt => (a < b) as u8 as f64,
            Self::Le => (a <= b) as u8 as f64,
            Self::Gt => (a > b) as u8 as f64,
            Self::Ge => (a >= b) as u8 as f64,
            Self::And => (truth(a) && truth(b)) as u8 as f64,
            Self::Or => (truth(a) || truth(b)) as u8 as f64,
            Self::Divisible => (b != 0.0 && a % b == 0.0) as u8 as f64,
        }
    }
}
#[derive(Clone, Copy, Debug)]
enum Unary {
    Neg,
    Abs,
    Sqrt,
    Floor,
    Ceil,
    Round,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    /// Radian trig (math_trig_rad).
    RSin,
    RCos,
    RTan,
    RAsin,
    RAcos,
    RAtan,
    Not,
    Ln,
    Log,
    Exp,
    Pow10,
    Even,
    Odd,
    Prime,
    Whole,
    Positive,
    Negative,
}
impl Unary {
    fn apply(self, v: f64) -> f64 {
        match self {
            Self::Neg => -v,
            Self::Abs => v.abs(),
            Self::Sqrt => v.sqrt(),
            Self::Floor => v.floor(),
            Self::Ceil => v.ceil(),
            Self::Round => (v + 0.5).floor(),
            Self::Sin => v.to_radians().sin(),
            Self::Cos => v.to_radians().cos(),
            Self::Tan => v.to_radians().tan(),
            Self::Asin => v.asin().to_degrees(),
            Self::Acos => v.acos().to_degrees(),
            Self::Atan => v.atan().to_degrees(),
            Self::RSin => v.sin(),
            Self::RCos => v.cos(),
            Self::RTan => v.tan(),
            Self::RAsin => v.asin(),
            Self::RAcos => v.acos(),
            Self::RAtan => v.atan(),
            Self::Not => (!truth(v)) as u8 as f64,
            Self::Ln => v.ln(),
            Self::Log => v.log10(),
            Self::Exp => v.exp(),
            Self::Pow10 => 10f64.powf(v),
            Self::Even => (v % 2.0 == 0.0) as u8 as f64,
            Self::Odd => (v.abs() % 2.0 == 1.0) as u8 as f64,
            Self::Prime => is_prime(v) as u8 as f64,
            Self::Whole => (v.is_finite() && v.fract() == 0.0) as u8 as f64,
            Self::Positive => (v > 0.0) as u8 as f64,
            Self::Negative => (v < 0.0) as u8 as f64,
        }
    }
}
fn is_prime(v: f64) -> bool {
    if !(v.fract() == 0.0 && (2.0..=9.007_199_254_740_991e15).contains(&v)) {
        return false;
    }
    let n = v as u64;
    if n < 4 {
        return true;
    }
    if n.is_multiple_of(2) {
        return false;
    }
    let mut d = 3;
    while d * d <= n {
        if n.is_multiple_of(d) {
            return false;
        }
        d += 2;
    }
    true
}
/// Point targets beside actor indices (actor_target uses usize::MAX for self).
const TARGET_MOUSE: usize = usize::MAX - 1;
const TARGET_RANDOM: usize = usize::MAX - 2;
const TARGET_EDGE: usize = usize::MAX - 3;
/// One stage edge: TARGET_EDGE_SIDE - (0 top, 1 bottom, 2 left, 3 right).
const TARGET_EDGE_SIDE: usize = usize::MAX - 4;
/// Every actor of a camp: TARGET_CAMP - (0 no camp, 1 red, 2 yellow/green, 3 blue).
const TARGET_CAMP: usize = usize::MAX - 10;
fn camp_target(id: &str) -> Option<usize> {
    camp_code(id).map(|c| TARGET_CAMP - c as usize)
}
fn camp_code(id: &str) -> Option<u8> {
    Some(match id {
        "no_camp" => 0,
        "camp_red" => 1,
        "camp_yellow" | "camp_green" => 2,
        "camp_blue" => 3,
        _ => return None,
    })
}
fn edge_target(id: &str) -> Option<usize> {
    Some(match id {
        "--edge" | "__edge" | "--boundary" | "__boundary" | "edge" => TARGET_EDGE,
        "--edge_top" | "__edge_top" => TARGET_EDGE_SIDE,
        "--edge_bottom" | "__edge_bottom" => TARGET_EDGE_SIDE - 1,
        "--edge_left" | "__edge_left" => TARGET_EDGE_SIDE - 2,
        "--edge_right" | "__edge_right" => TARGET_EDGE_SIDE - 3,
        _ => return None,
    })
}
fn truth(v: f64) -> bool {
    v != 0.0 && !v.is_nan()
}

#[derive(Clone, Copy, Debug)]
enum ExprOp {
    Constant(f64),
    Slot(usize),
    Local(usize),
    Value(usize),
    Truth(usize),
    Key(usize, bool),
    Coordinate(usize, bool),
    Orientation(usize),
    Scale(usize),
    Costume(usize),
    Mouse(bool),
    TextLength(usize),
    Random,
    Range(usize),
    ListLength(ListRef),
    ListItem(ListRef, bool),
    X,
    Y,
    Direction,
    Timer,
    Distance(usize),
    Time(u8),
    Effect(usize, u8),
    MouseDown(u8),
    CloneCount(usize),
    CloneIndex,
    /// (subject, other actor | TARGET_MOUSE | TARGET_EDGE)
    Touching(usize, usize),
    /// (subject, edge: 0 any, 1 top, 2 bottom, 3 left, 4 right)
    OutOfBounds(usize, u8),
    /// bump_into_color: (subject actor | camp target, 0xRRGGBB)
    TouchingColor(usize, u32),
    PhysicsProperty(physics::Property),
    LegacyPhysicsProperty(usize, physics::Property),
    Binary(Binary),
    Unary(Unary),
}
#[derive(Clone, Copy, Debug)]
struct Expr {
    /// One past the postfix root; the subtree start is `expression_starts[end - 1]`.
    end: u32,
}
#[derive(Clone, Copy, Debug)]
struct RangeSpec {
    from: Expr,
    to: Expr,
    by: Expr,
}

#[derive(Clone, Copy, Debug)]
enum TextPart {
    Literal(usize),
    Value(usize),
}
#[derive(Clone, Copy, Debug)]
enum PenProperty {
    Hue,
    Saturation,
    Brightness,
    Alpha,
}
#[derive(Clone, Copy, Debug)]
enum TimerState {
    Start,
    Stop,
    Reset,
}

#[derive(Clone, Copy, Debug)]
enum Op {
    WarpIteration,
    Set(usize, Expr),
    SetValue(Target, usize),
    SetLocal(usize, Expr),
    ChangeLocal(usize, Expr, f64),
    Change(usize, Expr, f64),
    Kitten4Change(Target, usize, bool),
    /// Code-view compound assignment; always interpreted (including hot loops).
    AssignLocal(usize, Option<usize>, Binary),
    Move(Expr),
    Position(Expr, Expr),
    X(Expr),
    Y(Expr),
    AddX(Expr),
    AddY(Expr),
    Turn(Expr),
    Direction(Expr),
    Scale(Expr),
    Visible(bool),
    Style(usize),
    NextStyle(bool),
    Opacity(Expr),
    PenLayer(PenLayer),
    Pen(bool),
    PenPath(bool),
    FillColor([f32; 4]),
    Color([f32; 4]),
    PenProperty(PenProperty, Expr, i8),
    Size(Expr),
    Clear,
    Audio(usize, bool),
    AudioProperty(usize, usize, bool, bool, bool),
    ClearList(ListRef),
    AppendList(ListRef, usize),
    DeleteList(ListRef, Option<Expr>),
    InsertList(ListRef, Expr, usize),
    ReplaceList(ListRef, Option<Expr>, usize),
    CopyList(ListRef, ListRef),
    TimerVisible(bool),
    Timer(TimerState),
    Range(usize, usize),
    RangeNext(usize, bool),
    Stamp(usize, Expr, TextAlign),
    Branch(Expr, usize),
    Jump(usize),
    Yield,
    Wait(Expr),
    WaitUntil(Expr),
    Broadcast(usize, Option<usize>, bool),
    Stop(u8),
    Repeat(Expr, usize),
    Next(usize, bool),
    Break(usize, usize),
    Log(usize),
    LogNumber(Expr),
    LogText(usize),
    Call(usize, usize),
    Return,
    /// procedures_2_return_value: return from the procedure with a value.
    ReturnValue(usize),
    Halt,
    ChangeScale(Expr),
    SizeAxis(bool, Expr, bool),
    PenSizeChange(Expr),
    Effect(u8, Expr, bool),
    ClearEffects,
    RotationType(u8),
    Flip(bool),
    FaceTo(usize),
    MoveToTarget(usize),
    RotateAround(usize, Expr),
    /// Starts a glide described by `glides[i]`; the next op is `AnimStep`.
    Glide(usize),
    /// Starts a fade (duration, show); the next op is `AnimStep`.
    Fade(Expr, bool),
    AnimStep,
    /// Run a body (start pc) as another actor; wait for it when true.
    Tell(usize, usize, bool),
    Restart,
    Clone(usize),
    /// Allocates sprites: must leave native code before invalidating its pointers.
    Split(usize, Expr, Expr),
    DisposeClone,
    DisposeSelf,
    SwitchScene(usize),
    SceneTransition(usize, usize),
    Dialog(usize, bool),
    CloseDialog,
    Bounce,
    Draggable(bool),
    ImageStamp,
    /// Play an audio value and wait for the viewer to report its end.
    AudioWait(usize),
    /// Show (true) or hide a variable/list monitor.
    Monitor(usize, bool),
    /// Question value and optional choice values (`value_args` span).
    Ask(usize, Option<Span>),
    Layer(LayerMove),
    /// self_set_role_camp: 0 none, 1 red, 2 yellow (shown green), 3 blue.
    Camp(u8),
    /// Emphasis animation (0 shake, 1 scale, 2 bounce); the next op is `TimelineStep`.
    Emphasis(u8),
    /// Appear (true) / disappear transition (kind, direction); next op `TimelineStep`.
    Transition(bool, u8, u8),
    TimelineStep,
    /// Render the sprite as text (value), set its text size, set its text colour (RGB).
    SpriteText(usize),
    TextSize(Expr),
    TextColor(u32),
    Physics(physics::Command, Expr, Expr, Expr),
    // Append private ops so existing global/JIT opcode discriminants stay stable.
    SetActorVariable(usize, usize),
    ChangeActorVariable(usize, Expr, f64),
    /// Legacy K4 velocity checks actual Number values, not coerced strings.
    PhysicsVelocity(usize, usize),
    LegacyPhysics(physics::Command, usize),
    CloudSet(usize, usize, bool, bool),
    CloudList(usize, u8, Option<Expr>, Option<usize>),
    Ranking(Option<usize>, bool),
}
#[derive(Clone, Copy, Debug)]
enum LayerMove {
    Front,
    Back,
    Forward,
    Backward,
    /// Directly above (true) or below (false) another actor.
    Relative(usize, bool),
    By(Expr),
}
#[derive(Clone, Copy, Debug)]
struct GlideSpec {
    time: Expr,
    x: Option<Expr>,
    y: Option<Expr>,
    relative: bool,
}
#[derive(Clone, Copy, Debug)]
enum Anim {
    Glide {
        start: f64,
        duration: f64,
        from: (f64, f64),
        to: (f64, f64),
    },
    Fade {
        start: f64,
        duration: f64,
        from: f64,
        to: f64,
        hide: bool,
    },
}

#[derive(Clone, Copy, Debug)]
enum PenLayer {
    Top,
    Bottom,
    Forward,
    Backward,
    Relative(usize, bool),
}

#[derive(Clone, Debug, Serialize)]
pub struct Sprite {
    pub id: String,
    pub name: String,
    pub style: Option<String>,
    pub x: f64,
    pub y: f64,
    pub direction: f64,
    pub scale: f64,
    pub visible: bool,
    pub opacity: f64,
    /// Effect values by native scope: 0 color, 2 brightness, 3 pixelate,
    /// 4 ripple, 5 twist, 6 grayscale (1 transparency is `opacity`).
    pub effects: [f64; 7],
    /// Width/height percentages applied on top of `scale`.
    pub size_x: f64,
    pub size_y: f64,
    #[serde(skip)]
    flip_x: bool,
    #[serde(skip)]
    flip_y: bool,
    /// 0 free rotation, 1 left-right flip, 2 no rotation.
    pub rotation_type: u8,
    /// Speech or thought bubble.
    pub dialog: Option<Dialog>,
    pub draggable: bool,
    /// Text the sprite is rendered as (self_text_effect_text), replacing its costume.
    /// Always serialized so leaving text mode reaches the renderer as `null`.
    pub text: Option<SpriteText>,
    #[serde(skip)]
    styles: Vec<String>,
    /// 0 no camp, 1 red, 2 yellow/green, 3 blue.
    #[serde(skip)]
    camp: u8,
    /// Text size and RGB colour kept even while no text is shown.
    #[serde(skip)]
    text_style: (f64, u32),
    /// Scale saved when text replaced the costume; restored on a costume change.
    #[serde(skip)]
    text_scale: Option<f64>,
    /// Original actor index (itself for originals); clones share their scripts.
    #[serde(skip)]
    origin: usize,
    /// 0 for originals, 1.. for clones in creation order.
    #[serde(skip)]
    clone_index: u32,
    /// K4 mirror has empty ordinary code; split inherits ordinary responders.
    #[serde(skip)]
    empty_code: bool,
    #[serde(skip)]
    alive: bool,
    /// Independent per-entity cells. Clone creation deep-copies the current table.
    #[serde(skip)]
    variables: BTreeMap<usize, Cell>,
    #[serde(skip)]
    scene: usize,
    #[serde(skip)]
    stage: bool,
    #[serde(skip)]
    pen: bool,
    #[serde(skip)]
    color: [f32; 4],
    #[serde(skip)]
    hsv: [f64; 3],
    #[serde(skip)]
    size: f64,
    #[serde(skip)]
    fill_color: Option<[f32; 4]>,
    #[serde(skip)]
    fill_path: Option<Vec<[f64; 2]>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SpriteText {
    pub text: String,
    pub size: f64,
    /// `#rrggbb`
    pub color: String,
}
impl SpriteText {
    /// Estimated rendered size: CJK glyphs one em wide, others about half.
    fn extent(&self) -> (f64, f64) {
        let lines: Vec<&str> = self.text.split('\n').collect();
        let width = lines
            .iter()
            .map(|line| {
                line.chars()
                    .map(|c| if c.is_ascii() { 0.55 } else { 1.0 })
                    .sum::<f64>()
            })
            .fold(0.0, f64::max);
        (
            (width * self.size).max(1.0),
            lines.len() as f64 * self.size * 1.25,
        )
    }
}
static TEXT_COSTUME: Costume = Costume {
    width: 1.0,
    height: 1.0,
    center_point: [0.0; 2],
    mask: None,
    rgb: None,
};

/// Costume size in pixels and an optional opacity mask (1 bit per cell,
/// row-major, top row first) used for collision tests.
#[derive(Clone, Debug, Default)]
pub struct Costume {
    pub width: f64,
    pub height: f64,
    /// Pivot relative to the image centre in unscaled pixels: x right, y down.
    pub center_point: [f64; 2],
    pub mask: Option<(usize, usize, Vec<u8>)>,
    /// RGB per mask cell (row-major, 3 bytes each), sent for color sensing.
    pub rgb: Option<Vec<u8>>,
}
impl Costume {
    /// Missing, nonnumeric or nonfinite pivot components default independently to zero.
    pub fn center_point_from_json(value: &Value) -> [f64; 2] {
        ["x", "y"].map(|key| value[key].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0))
    }
}

/// The renderer's actorGeometry in stage coordinates (y up). Signed dimensions
/// include left/right mirroring; all collision and pen sampling uses this transform.
struct CostumeGeometry<'a> {
    costume: &'a Costume,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    angle: f64,
}
impl CostumeGeometry<'_> {
    fn bounds(&self) -> (f64, f64, f64, f64) {
        let (s, c) = self.angle.sin_cos();
        let (hw, hh) = (self.width.abs() / 2.0, self.height.abs() / 2.0);
        let ex = hw * c.abs() + hh * s.abs();
        let ey = hw * s.abs() + hh * c.abs();
        (self.x - ex, self.x + ex, self.y - ey, self.y + ey)
    }

    fn uv(&self, x: f64, y: f64) -> Option<(f64, f64)> {
        if self.width == 0.0 || self.height == 0.0 {
            return None;
        }
        let (s, c) = self.angle.sin_cos();
        let (dx, dy) = (x - self.x, y - self.y);
        Some((
            (c * dx - s * dy) / self.width + 0.5,
            0.5 - (s * dx + c * dy) / self.height,
        ))
    }

    fn point(&self, u: f64, v: f64) -> (f64, f64) {
        let (s, c) = self.angle.sin_cos();
        let (lx, ly) = ((u - 0.5) * self.width, (0.5 - v) * self.height);
        (self.x + c * lx + s * ly, self.y - s * lx + c * ly)
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct ImageStamp {
    pub before_line: usize,
    pub style: Option<String>,
    pub x: f64,
    pub y: f64,
    pub direction: f64,
    pub scale: f64,
    pub size_x: f64,
    pub size_y: f64,
    pub rotation_type: u8,
    pub opacity: f64,
    pub effects: [f64; 7],
}
#[derive(Clone, Debug, Serialize)]
pub struct Monitor {
    pub id: String,
    pub name: String,
    pub list: bool,
    pub value: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Dialog {
    pub text: String,
    pub think: bool,
}
/// A question waiting for the viewer. The asking task is suspended until
/// `Engine::answer` supplies the reply.
#[derive(Clone, Debug, Serialize)]
pub struct AskRequest {
    pub id: u64,
    /// Asking sprite (empty for the stage), for positioning the prompt.
    pub sprite: String,
    pub question: String,
    /// Present for ask-and-choose.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<String>>,
    #[serde(skip)]
    task: u64,
}
#[derive(Clone, Debug)]
struct Script {
    start: usize,
    hat: String,
    actor: usize,
    event: ScriptEvent,
}

#[derive(Clone, Debug)]
enum ScriptEvent {
    Start,
    /// KN level-triggered root; one persistent, scene-suspended task per hat.
    KnWhen,
    K4GlobalStart,
    K4SceneActivate,
    CloneStart,
    Key(String, bool),
    Pointer(String, String),
    Swipe(String),
    K4Backdrop(String),
    Broadcast(usize, bool),
    /// on_bump_actor: (other actor, 0 start / 1 move / 2 end).
    Bump(usize, u8),
}

/// A scene ("running group"): its stage entity and actors (front to back).
#[derive(Clone, Debug)]
pub struct SceneInfo {
    pub id: String,
    pub name: String,
    pub stage: usize,
    pub actors: Vec<usize>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Transition {
    pub direction: String,
    pub kind: String,
}
/// Execution provenance, captured before lowering removes native metadata.
/// This is private VM state, not a new canonical-project or wire-format field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeSemantics {
    KnCurrent,
    Kitten4,
}

impl RuntimeSemantics {
    fn from_project(project: &Value) -> Result<Self> {
        let Some(metadata) = project.get("_nekocKitten4") else {
            return Ok(Self::KnCurrent);
        };
        let source = metadata
            .get("source")
            .context("malformed _nekocKitten4 provenance: source is missing")?;
        ensure!(
            crate::kitten4::is_kitten4(source),
            "malformed _nekocKitten4 provenance: source must be a native Kitten 4 project"
        );
        // Match the existing importer, without guessing from canonical toolType,
        // application_version or legacy flags. KN optional-input defaults and
        // K4 held-key policy both use this per-program provenance.
        ensure!(
            matches!(source.get("version").and_then(Value::as_u64), Some(24 | 25)),
            "unsupported Kitten 4 provenance version {}; this adapter supports versions 24 and 25",
            source["version"]
        );
        // Reuse the importer's structural validation rather than inventing a
        // stricter metadata schema (published sources need no workspace). The
        // canonical project may have been edited, so do not compare it to this
        // fresh import or require an export round-trip to succeed.
        crate::kitten4::validate_source(source)
            .context("malformed _nekocKitten4 provenance: source cannot be imported")?;
        Ok(Self::Kitten4)
    }
}

#[derive(Debug)]
pub struct Program {
    cloud: Vec<cloud::Binding>,
    deep_values: BTreeSet<usize>,
    semantics: RuntimeSemantics,
    ops: Vec<Op>,
    legacy_physics_scenes: BTreeSet<usize>,
    has_modern_physics: bool,
    expressions: Vec<ExprOp>,
    /// For each postfix position, the first position of the subtree rooted there.
    /// A binary node at `p` has its right operand at `p - 1` and its left operand at
    /// `expression_starts[p - 1] - 1`, so evaluation needs no runtime value stack.
    expression_starts: Vec<u32>,
    sources: Vec<String>,
    strings: Vec<String>,
    texts: Vec<Vec<TextPart>>,
    ranges: Vec<RangeSpec>,
    glides: Vec<GlideSpec>,
    initial_lists: Vec<Vec<Cell>>,
    initial_values: Vec<Option<Cell>>,
    values: Vec<ValueExpr>,
    /// KN Select reporters with an omitted end. Keep the existing value/JIT
    /// representation: the placeholder end is constant and is never evaluated.
    single_text_selects: BTreeSet<usize>,
    constants: Vec<Cell>,
    value_args: Vec<usize>,
    local_count: usize,
    code_locals: BTreeSet<usize>,
    scripts: Vec<Script>,
    initial: Vec<f64>,
    procedure_entries: Vec<usize>,
    call_arguments: Vec<Vec<usize>>,
    pub variable_names: Vec<String>,
    actor_variable_names: Vec<String>,
    style_names: BTreeMap<String, String>,
    /// Costume sizes from the project file, replaced by viewer-measured ones.
    costumes: BTreeMap<String, Costume>,
    display_names: BTreeMap<String, String>,
    /// Monitor targets: variable slot or list index with its id.
    monitor_targets: Vec<(String, bool, usize)>,
    /// Private monitor index -> (declaring original entity, private slot).
    actor_monitors: BTreeMap<usize, (usize, usize)>,
    pub list_names: Vec<String>,
    pub sprites: Vec<Sprite>,
    pub width: f64,
    pub height: f64,
    pub scene: String,
    pub backdrop: Option<String>,
    /// All scenes in project order; only `scenes[current]` is drawn. K4 global
    /// Start tasks can run outside their owner's active scene.
    pub scenes: Vec<SceneInfo>,
    pub initial_scene: usize,
    /// The project uses bump_into_color: the VM keeps a pen raster and needs
    /// costume colours from the viewer.
    pub uses_color: bool,
    /// Heading at which a costume is drawn unrotated: 0 in Kitten N, 90 in Kitten 4.
    pub costume_turn: f64,
}

#[derive(Debug, Serialize)]
pub struct CompileStats {
    pub instructions: usize,
    pub instruction_bytes: usize,
    pub expression_ops: usize,
    pub variables: usize,
    pub lists: usize,
    pub scripts: usize,
}

/// A diagnostic pass can reuse provenance validation and lowering across roots.
/// This never changes the caller's canonical document or its runtime semantics.
pub(crate) struct PreparedProject<'a> {
    pub project: PreparedJson<'a>,
    semantics: RuntimeSemantics,
    start_hats: crate::kitten4::StartHats,
    k4_owners: Vec<String>,
}

pub(crate) enum PreparedJson<'a> {
    Borrowed(&'a Value),
    Owned(crate::json::Json),
}

impl AsRef<Value> for PreparedJson<'_> {
    fn as_ref(&self) -> &Value {
        match self {
            Self::Borrowed(value) => value,
            Self::Owned(value) => value,
        }
    }
}

impl std::ops::Deref for PreparedJson<'_> {
    type Target = Value;
    fn deref(&self) -> &Value {
        self.as_ref()
    }
}

impl PreparedProject<'_> {
    pub fn compile(&self, project: &Value) -> Result<Program> {
        crate::json::check_blocks(project, crate::json::MAX_BLOCK_DEPTH)?;
        crate::json::expanded(|| {
            Program::compile_canonical(
                project,
                self.semantics,
                self.start_hats.clone(),
                &self.k4_owners,
            )
        })
    }
}

impl Program {
    /// Diagnostic IR, not a stable persistence format. Includes all compiled
    /// fields (also source IDs); inequality alone does not prove a semantic bug.
    pub fn oracle_program(&self) -> String {
        format!("{self:#?}")
    }

    pub fn stats(&self) -> CompileStats {
        CompileStats {
            instructions: self.ops.len(),
            instruction_bytes: self.ops.len() * std::mem::size_of::<Op>(),
            expression_ops: self.expressions.len(),
            variables: self.initial.len() + self.actor_variable_names.len(),
            lists: self.initial_lists.len(),
            scripts: self.scripts.len(),
        }
    }
    /// Compiles a project. A self-extracting packed project (see `crate::pack`)
    /// is unpacked natively first instead of running its block decoder.
    pub fn compile(project: &Value) -> Result<Self> {
        Self::compile_project(project, true)
    }
    /// Compiles without native unpacking (packed projects run their decoder).
    /// K4 provenance and VM lowering still apply; exact is not a platform bypass.
    pub fn compile_exact(project: &Value) -> Result<Self> {
        Self::compile_project(project, false)
    }
    fn compile_project(project: &Value, unpack: bool) -> Result<Self> {
        let _timing = crate::import_perf::span("engine_compile_total");
        let prepared = Self::prepare(project, unpack)?;
        prepared.compile(&prepared.project)
    }
    pub(crate) fn prepare(project: &Value, unpack: bool) -> Result<PreparedProject<'_>> {
        let _timing = crate::import_perf::span("engine_prepare");
        crate::json::check_blocks(project, crate::json::MAX_BLOCK_DEPTH)?;
        let semantics = RuntimeSemantics::from_project(project)?;
        let start_hats = if semantics == RuntimeSemantics::Kitten4 {
            crate::kitten4::start_hats(&project["_nekocKitten4"]["source"])
                .context("invalid Kitten 4 start provenance")?
        } else {
            crate::kitten4::StartHats::new()
        };
        let source = &project["_nekocKitten4"]["source"];
        let k4_owners = if let Some(compiled) = source["compile_result"].as_array() {
            compiled
                .iter()
                .filter_map(|e| e["id"].as_str().map(str::to_owned))
                .collect()
        } else {
            ["scenes", "actors"]
                .into_iter()
                .flat_map(|section| {
                    source["theatre"][section]
                        .as_object()
                        .into_iter()
                        .flat_map(|o| o.keys().cloned())
                })
                .collect()
        };
        let project = if unpack && crate::pack::is_packed(project) {
            PreparedJson::Owned(crate::pack::unpack(project)?)
        } else {
            PreparedJson::Borrowed(project)
        };
        let project = if semantics == RuntimeSemantics::Kitten4 {
            PreparedJson::Owned(crate::kitten4::lower_for_vm(&project))
        } else {
            // KN historically used serde_json's sorted object maps. Preserve
            // that execution policy despite retaining insertion order for K4.
            let mut sorted = crate::json::Json::new(crate::json::clone_value(&project));
            crate::json::sort_objects(&mut sorted);
            PreparedJson::Owned(sorted)
        };
        Ok(PreparedProject {
            project,
            semantics,
            start_hats,
            k4_owners,
        })
    }
    fn compile_canonical(
        project: &Value,
        semantics: RuntimeSemantics,
        start_hats: crate::kitten4::StartHats,
        k4_owners: &[String],
    ) -> Result<Self> {
        let _timing = crate::import_perf::span("engine_compile_canonical");
        // K4 player load/start selects scenes_order[0], not the editor's saved
        // current_scene. Keep the canonical selection intact for round trips.
        // Official evidence and invalid-order boundary: docs/kitten4-scenes.md.
        let scene_path = if semantics == RuntimeSemantics::Kitten4 {
            "/scenes/sortList/0"
        } else {
            "/scenes/currentSceneId"
        };
        let scene = project
            .pointer(scene_path)
            .and_then(Value::as_str)
            .context("project has no current scene")?
            .to_owned();
        let scene_value = project
            .pointer("/scenes/scenesDict")
            .and_then(|m| m.get(&scene))
            .context("current scene missing")?;
        let mut compiler = Compiler {
            start_hats,
            program: Self {
                cloud: vec![],
                deep_values: BTreeSet::new(),
                semantics,
                ops: vec![],
                legacy_physics_scenes: BTreeSet::new(),
                has_modern_physics: false,
                expressions: vec![],
                expression_starts: vec![],
                sources: vec![],
                strings: vec![],
                texts: vec![],
                ranges: vec![],
                glides: vec![],
                initial_lists: vec![],
                initial_values: vec![],
                values: vec![],
                single_text_selects: BTreeSet::new(),
                constants: vec![],
                value_args: vec![],
                local_count: 0,
                code_locals: BTreeSet::new(),
                scripts: vec![],
                initial: vec![],
                procedure_entries: vec![],
                call_arguments: vec![],
                variable_names: vec![],
                actor_variable_names: vec![],
                costumes: project
                    .pointer("/styles/stylesDict")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .filter_map(|(id, style)| {
                        let (width, height) = (style["width"].as_f64()?, style["height"].as_f64()?);
                        Some((
                            id.clone(),
                            Costume {
                                width,
                                height,
                                center_point: Costume::center_point_from_json(
                                    &style["centerPoint"],
                                ),
                                mask: None,
                                rgb: None,
                            },
                        ))
                    })
                    .collect(),
                display_names: project
                    .pointer("/variables/variablesDict")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .map(|(id, v)| (id.clone(), v["name"].as_str().unwrap_or(id).to_owned()))
                    .collect(),
                monitor_targets: vec![],
                actor_monitors: BTreeMap::new(),
                style_names: project
                    .pointer("/styles/stylesDict")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .filter_map(|(id, style)| {
                        Some((id.clone(), style["name"].as_str()?.to_owned()))
                    })
                    .collect(),
                list_names: vec![],
                sprites: vec![],
                width: project["stageSize"]["width"].as_f64().unwrap_or(900.0),
                height: project["stageSize"]["height"].as_f64().unwrap_or(562.0),
                scene: scene.clone(),
                backdrop: scene_value["currentStyleId"].as_str().map(str::to_owned),
                scenes: vec![],
                initial_scene: 0,
                uses_color: false,
                costume_turn: if semantics == RuntimeSemantics::Kitten4 {
                    90.0
                } else {
                    0.0
                },
            },
            slots: BTreeMap::new(),
            actor_variables: BTreeMap::new(),
            locals: BTreeMap::new(),
            lists: BTreeMap::new(),
            ranges: vec![],
            procedures: BTreeMap::new(),
            procedure_params: BTreeMap::new(),
            parameters: BTreeMap::new(),
            loops: vec![],
            expression_work: vec![],
            compile_work: false,
            compile_depth: 0,
            actor_ids: vec![],
            owner_scene: 0,
        };
        let mut definitions = vec![];
        if let Some(procedures) = project
            .pointer("/procedures/proceduresDict")
            .and_then(Value::as_object)
        {
            for (id, procedure) in procedures {
                let definition = procedure["nekoBlockJsonList"].as_array().and_then(|roots| {
                    roots.iter().find(|b| {
                        matches!(
                            b["type"].as_str(),
                            Some("procedures_2_defnoreturn" | "procedures_2_defreturn")
                        )
                    })
                });
                if let Some(definition) = definition {
                    let base = compiler.program.procedure_entries.len();
                    compiler.program.procedure_entries.extend([0, 0]);
                    compiler.procedures.insert(id.clone(), base);
                    let params = procedure["params"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|p| p["type"] != "Label")
                        .map(|p| ProcedureParam {
                            id: p["id"].as_str().unwrap_or("").to_owned(),
                            name: p["name"].as_str().unwrap_or("").to_owned(),
                            kind: p["type"].as_str().unwrap_or("").to_owned(),
                            options: p.get("options").cloned().unwrap_or(Value::Null),
                        })
                        .collect::<Vec<_>>();
                    compiler.procedure_params.insert(base, params);
                    definitions.push((base, definition));
                }
            }
        }
        ensure!(
            compiler.program.width.is_finite()
                && compiler.program.height.is_finite()
                && (1.0..=8192.0).contains(&compiler.program.width)
                && (1.0..=8192.0).contains(&compiler.program.height),
            "invalid stage dimensions"
        );
        if let Some(vars) = project
            .pointer("/variables/variablesDict")
            .and_then(Value::as_object)
        {
            for (id, var) in vars {
                if semantics == RuntimeSemantics::Kitten4 && var["cloud"].is_object() {
                    compiler.program.cloud.push(cloud::Binding {
                        id: id.clone(),
                        remote: var["cloud"]["cvid"].as_str().unwrap_or(id).to_owned(),
                        private: var["cloud"]["type"] == "private",
                        list: var["type"] == "list",
                    });
                }
                let value = var.get("value").unwrap_or(&Value::Null);
                if var["isGlobal"] == false
                    || (var["isGlobal"].is_null()
                        && var["currentEntityId"]
                            .as_str()
                            .is_some_and(|id| !id.is_empty()))
                {
                    let slot = compiler.program.actor_variable_names.len();
                    compiler.program.actor_variable_names.push(id.clone());
                    compiler.actor_variables.insert(id.clone(), slot);
                    continue;
                }
                if var["type"] == "list" {
                    let items = value
                        .as_array()
                        .with_context(|| format!("list {id}: expected array"))?;
                    let values = items
                        .iter()
                        .map(Cell::from_json)
                        .collect::<Result<Vec<_>>>()?;
                    compiler
                        .lists
                        .insert(id.clone(), compiler.program.initial_lists.len());
                    compiler.program.list_names.push(id.clone());
                    compiler.program.initial_lists.push(values);
                    continue;
                }
                let slot = compiler.slot(id);
                let value = Cell::from_json(value)?;
                compiler.program.initial[slot] = value.number();
                if !matches!(value, Cell::Number(_) | Cell::Null) {
                    compiler.program.initial_values[slot] = Some(value);
                }
            }
        }
        // Every scene is compiled. Pass 1 creates all entities so scripts can
        // reference actors of any scene, including K4 global Start owners.
        let scenes_dict = project
            .pointer("/scenes/scenesDict")
            .and_then(Value::as_object)
            .context("project requires scenes")?;
        let mut scene_ids: Vec<String> = project
            .pointer("/scenes/sortList")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|id| scenes_dict.contains_key(*id))
            .map(str::to_owned)
            .collect();
        for id in scenes_dict.keys() {
            if !scene_ids.contains(id) {
                scene_ids.push(id.clone());
            }
        }
        for (scene_index, scene_id) in scene_ids.iter().enumerate() {
            let scene_value = &scenes_dict[scene_id];
            let stage = compiler.program.sprites.len();
            // Stage scripts have no sprite target. A hidden entity gives them scalar state.
            compiler.program.sprites.push(Sprite {
                id: scene_id.clone(),
                name: "Stage".into(),
                style: scene_value["currentStyleId"].as_str().map(str::to_owned),
                x: 0.0,
                y: 0.0,
                direction: 0.0,
                scale: 100.0,
                visible: false,
                opacity: 1.0,
                effects: [0.0; 7],
                size_x: 100.0,
                size_y: 100.0,
                flip_x: false,
                flip_y: false,
                rotation_type: 0,
                dialog: None,
                draggable: false,
                text: None,
                styles: owner_styles(scene_value),
                camp: 0,
                text_style: (36.0, 0),
                text_scale: None,
                origin: stage,
                clone_index: 0,
                empty_code: false,
                alive: true,
                variables: BTreeMap::new(),
                scene: scene_index,
                stage: true,
                pen: false,
                fill_color: None,
                fill_path: None,
                color: [0.0, 0.0, 0.0, 1.0],
                hsv: [0.0; 3],
                size: 1.0,
            });
            let mut actors = vec![];
            for id in scene_value["actorIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                let actor = project
                    .pointer("/actors/actorsDict")
                    .and_then(|m| m.get(id))
                    .with_context(|| format!("missing actor {id}"))?;
                let index = compiler.program.sprites.len();
                compiler.program.sprites.push(Sprite {
                    id: id.into(),
                    name: actor["name"].as_str().unwrap_or(id).into(),
                    style: actor["currentStyleId"].as_str().map(str::to_owned),
                    x: actor["position"]["x"].as_f64().unwrap_or(0.0),
                    y: actor["position"]["y"].as_f64().unwrap_or(0.0),
                    direction: actor["rotation"].as_f64().unwrap_or(0.0).to_degrees(),
                    scale: actor["scale"].as_f64().unwrap_or(100.0),
                    visible: actor["visible"].as_bool().unwrap_or(true),
                    opacity: 1.0,
                    effects: [0.0; 7],
                    size_x: 100.0,
                    size_y: 100.0,
                    flip_x: false,
                    flip_y: false,
                    rotation_type: actor["rotationType"].as_u64().unwrap_or(0).min(2) as u8,
                    dialog: None,
                    draggable: actor["draggable"].as_bool().unwrap_or(false),
                    text: None,
                    styles: owner_styles(actor),
                    camp: actor["group"]
                        .as_str()
                        .or_else(|| actor["camp"].as_str())
                        .and_then(camp_code)
                        .unwrap_or(0),
                    text_style: (36.0, 0),
                    text_scale: None,
                    origin: index,
                    clone_index: 0,
                    empty_code: false,
                    alive: true,
                    variables: BTreeMap::new(),
                    scene: scene_index,
                    stage: false,
                    pen: false,
                    fill_color: None,
                    fill_path: None,
                    color: [0.0, 0.0, 0.0, 1.0],
                    hsv: [0.0; 3],
                    size: 1.0,
                });
                actors.push(index);
            }
            compiler.program.scenes.push(SceneInfo {
                id: scene_id.clone(),
                name: scene_value["screenName"]
                    .as_str()
                    .or_else(|| scene_value["name"].as_str())
                    .unwrap_or(scene_id)
                    .to_owned(),
                stage,
                actors,
            });
        }
        if let Some(vars) = project
            .pointer("/variables/variablesDict")
            .and_then(Value::as_object)
        {
            for (id, &slot) in &compiler.actor_variables {
                let var = &vars[id];
                let owner = var["currentEntityId"]
                    .as_str()
                    .or_else(|| var["current_entity"].as_str())
                    .with_context(|| format!("private variable {id}: missing owner"))?;
                let sprite = compiler
                    .program
                    .sprites
                    .iter_mut()
                    .find(|s| s.id == owner)
                    .with_context(|| format!("private variable {id}: unknown owner {owner}"))?;
                sprite
                    .variables
                    .insert(slot, Cell::from_json(&var["value"])?);
            }
        }
        compiler.program.initial_scene = scene_ids
            .iter()
            .position(|id| *id == scene)
            .context("current scene missing")?;
        // Pass 2: scripts, resolving actor references within the owner's scene first.
        for scene_index in 0..compiler.program.scenes.len() {
            let info = compiler.program.scenes[scene_index].clone();
            compiler.owner_scene = scene_index;
            compiler.actor_ids = info
                .actors
                .iter()
                .map(|&i| compiler.program.sprites[i].id.clone())
                .collect();
            compiler
                .scripts(&scenes_dict[&info.id], info.stage)
                .with_context(|| format!("scene {}", info.name))?;
            for &index in &info.actors {
                let id = compiler.program.sprites[index].id.clone();
                let actor = &project["actors"]["actorsDict"][&id];
                compiler.scripts(actor, index)?;
            }
        }
        // Only compile called procedures, following calls discovered while compiling
        // their bodies. Unused procedures are preserved by the document layer.
        let mut compiled = vec![false; compiler.program.procedure_entries.len()];
        loop {
            let pending = compiler
                .program
                .ops
                .iter()
                .filter_map(|op| {
                    if let Op::Call(index, _) = op {
                        (!compiled[*index]).then_some(*index)
                    } else {
                        None
                    }
                })
                .chain(compiler.program.values.iter().filter_map(|value| {
                    if let ValueExpr::CallReturn(index, _) = value {
                        (!compiled[*index]).then_some(*index)
                    } else {
                        None
                    }
                }))
                .collect::<std::collections::BTreeSet<_>>();
            if pending.is_empty() {
                break;
            }
            for index in pending {
                compiled[index] = true;
                let definition = definitions
                    .iter()
                    .find(|(base, _)| *base == index / 2 * 2)
                    .unwrap()
                    .1;
                ensure!(
                    !compiler.procedure_params[&(index / 2 * 2)].is_empty()
                        || !["Number", "String", "Boolean"].iter().any(|kind| {
                            definition["mutation"]
                                .as_str()
                                .unwrap_or("")
                                .contains(&format!("type=\"{kind}\""))
                        }),
                    "called procedure has parameter mutation but no params metadata"
                );
                compiler.parameters = compiler.procedure_params[&(index / 2 * 2)]
                    .iter()
                    .enumerate()
                    .map(|(i, param)| (param.name.clone(), i))
                    .collect();
                compiler.program.procedure_entries[index] = compiler.program.ops.len();
                compiler.chain(definition["statements"].get("STACK"), index % 2 == 1)?;
                compiler.emit(Op::Return, definition);
            }
        }
        compiler.program.expression_starts = expression_starts(&compiler.program.expressions)?;
        if semantics == RuntimeSemantics::Kitten4 {
            // iNFq/create_singleton_entity_instances follows mXOY's loaded
            // typeclass order, not the stage's display/layer order.
            compiler.program.scripts.sort_by_key(|script| {
                let id = &compiler.program.sprites[script.actor].id;
                k4_owners
                    .iter()
                    .position(|owner| owner == id)
                    .unwrap_or(usize::MAX)
            });
        }
        Ok(compiler.program)
    }
}

fn expression_starts(expressions: &[ExprOp]) -> Result<Vec<u32>> {
    let mut pending = Vec::with_capacity(64);
    let mut starts = Vec::with_capacity(expressions.len());
    for (pc, op) in expressions.iter().enumerate() {
        let operands = match op {
            ExprOp::Binary(_) | ExprOp::Random => 2,
            ExprOp::Unary(_) | ExprOp::ListItem(_, false) => 1,
            _ => 0,
        };
        let mut start = pc as u32;
        for _ in 0..operands {
            start = pending.pop().context("malformed expression program")?;
        }
        starts.push(start);
        pending.push(start);
    }
    Ok(starts)
}

/// Compile-time metadata only: call frames and runtime/JIT value layouts stay
/// unchanged. Preserve declaration order independently of JSON map key order.
#[derive(Clone)]
struct ProcedureParam {
    id: String,
    name: String,
    kind: String,
    options: Value,
}

struct Compiler {
    compile_work: bool,
    compile_depth: usize,
    program: Program,
    start_hats: crate::kitten4::StartHats,
    slots: BTreeMap<String, usize>,
    actor_variables: BTreeMap<String, usize>,
    locals: BTreeMap<String, usize>,
    lists: BTreeMap<String, usize>,
    ranges: Vec<String>,
    procedures: BTreeMap<String, usize>,
    procedure_params: BTreeMap<usize, Vec<ProcedureParam>>,
    parameters: BTreeMap<String, usize>,
    loops: Vec<Vec<usize>>,
    expression_work: Vec<ExprOp>,
    /// Actor ids of the scene whose scripts are being compiled (front to back).
    actor_ids: Vec<String>,
    owner_scene: usize,
}
/// Native effect scope: 0 color, 1 transparency, 2 brightness, 3 pixelate,
/// 4 ripple, 5 twist, 6 grayscale (KN and Kitten 4 dropdown codes).
/// on_bump_actor_value attribute: 0 x, 1 y, 2 costume no., 3 camp, 4 clone index,
/// 5 scale, 6 width, 7 height, 8 direction, 10 + n effect n.
fn bump_attribute(name: &str) -> Option<u8> {
    Some(match name {
        "x" => 0,
        "y" => 1,
        "style_index" => 2,
        "camp" => 3,
        "clone_index" => 4,
        "scale" => 5,
        "width" => 6,
        "height" => 7,
        "direction" => 8,
        n => 10 + n.parse::<u8>().ok().filter(|n| *n <= 6)?,
    })
}
fn effect_scope(scope: &str) -> Option<u8> {
    match scope {
        "0" | "color" => Some(0),
        "1" | "ghost" | "transparency" => Some(1),
        "2" | "brightness" => Some(2),
        "3" | "pixelate" => Some(3),
        "4" | "mosaic" | "ripple" => Some(4),
        "5" | "twist" | "whirl" => Some(5),
        "6" | "grey" | "gray" | "grayscale" => Some(6),
        _ => None,
    }
}
fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v["fields"][key].as_str().unwrap_or("")
}
fn k4_round(value: f64) -> f64 {
    (value * 100.0 + 0.5).floor() / 100.0
}

/// lodash.toNumber's binary/octal/hex string cases (official K4 convert_type).
fn k4_number_text(text: &str) -> f64 {
    let text = text.trim().trim_matches('\u{feff}').trim();
    if text.is_empty() {
        return 0.0;
    }
    for (prefixes, radix) in [(["0x", "0X"], 16), (["0b", "0B"], 2), (["0o", "0O"], 8)] {
        if let Some(digits) = prefixes.iter().find_map(|prefix| text.strip_prefix(prefix)) {
            return if digits.is_empty() {
                f64::NAN
            } else {
                digits
                    .chars()
                    .try_fold(0.0, |n, c| {
                        c.to_digit(radix)
                            .map(|v| n * f64::from(radix) + f64::from(v))
                    })
                    .unwrap_or(f64::NAN)
            };
        }
    }
    if matches!(text, "Infinity" | "+Infinity" | "-Infinity") {
        return if text.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    static DECIMAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let decimal = DECIMAL.get_or_init(|| {
        regex::Regex::new(r"\A[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z")
            .expect("constant JS decimal pattern")
    });
    if decimal.is_match(text) {
        text.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}
fn owner_styles(owner: &Value) -> Vec<String> {
    let mut styles: Vec<String> = owner["styles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    if let Some(current) = owner["currentStyleId"].as_str()
        && !styles.iter().any(|id| id == current)
    {
        styles.push(current.into());
    }
    styles
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| {
        let text = v.as_str()?.trim();
        if text.is_empty() {
            Some(0.0)
        } else {
            text.parse().ok()
        }
    })
}
/// KN editor-normalized value compatibility, not raw-core TEXT semantics.
/// NUM presence (even invalid/null) keeps the old numeric path. Only a string
/// TEXT outside FieldNumber's untrimmed decimal subset becomes a text value.
fn kn_preserved_number_text(b: &Value) -> Option<&str> {
    if b["fields"].get("NUM").is_some() {
        return None;
    }
    let text = b["fields"].get("TEXT")?.as_str()?;
    static DECIMAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let decimal = DECIMAL.get_or_init(|| {
        regex::Regex::new(r"\A[+-]?[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?\z")
            .expect("constant FieldNumber decimal pattern")
    });
    // Infinity/NaN and Rust-accepted nonfinite spellings were not part of the
    // official oracle. Preserve their old parse/error path, not new text rules.
    if decimal.is_match(text) || text.trim().parse::<f64>().is_ok_and(|n| !n.is_finite()) {
        None
    } else {
        Some(text)
    }
}
fn input<'a>(v: &'a Value, key: &str) -> Result<&'a Value> {
    v.get("inputs")
        .and_then(|m| m.get(key))
        .with_context(|| format!("{}: missing input {key}", v["type"]))
}
impl Compiler {
    fn deep_value(&mut self, root: &Value) -> Result<usize> {
        self.compile_work = true;
        let result = self.deep_value_inner(root);
        self.compile_work = false;
        if let Ok(index) = result {
            self.program.deep_values.insert(index);
        }
        result
    }
    fn deep_value_inner(&mut self, root: &Value) -> Result<usize> {
        let mut work = vec![(root, false)];
        let mut output = BTreeMap::new();
        while let Some((node, exit)) = work.pop() {
            ensure!(
                node["type"] != "_compiled_value",
                "reserved internal expression type"
            );
            if !exit {
                work.push((node, true));
                for child in node["inputs"]
                    .as_object()
                    .into_iter()
                    .flat_map(|o| o.values())
                    .rev()
                {
                    // These reporters must retain their special list/range identity.
                    if !matches!(
                        child["type"].as_str(),
                        Some("pure_list_get" | "list_get" | "traverse_number_param")
                    ) {
                        work.push((child, false));
                    }
                }
                continue;
            }
            let mut shallow = Value::Object(
                node.as_object()
                    .context("expression must be an object")?
                    .iter()
                    .filter(|(k, _)| !matches!(k.as_str(), "inputs" | "statements" | "next"))
                    .map(|(k, v)| (k.clone(), crate::json::clone_value(v)))
                    .collect(),
            );
            if let Some(inputs) = node["inputs"].as_object() {
                shallow["inputs"] = Value::Object(
                    inputs
                        .iter()
                        .map(|(key, child)| {
                            let address = child as *const Value as usize;
                            let proxy = match output.remove(&address) {
                                Some(index) => json_proxy(index),
                                None => crate::json::clone_value(child),
                            };
                            (key.clone(), proxy)
                        })
                        .collect(),
                );
            }
            let value = self.value(&shallow)?;
            self.program.deep_values.insert(value);
            output.insert(node as *const Value as usize, value);
        }
        Ok(output.remove(&(root as *const Value as usize)).unwrap())
    }
    fn list(&mut self, b: &Value) -> Result<ListRef> {
        match b["type"].as_str() {
            Some("pure_list_get" | "list_get")
                if self.actor_variables.contains_key(field(b, "list")) =>
            {
                let slot = self.actor_variables[field(b, "list")];
                let value = self.program.values.len();
                self.program
                    .values
                    .push(ValueExpr::ActorVariable(usize::MAX, slot, None));
                Ok(ListRef::Expression(value as u32))
            }
            Some("pure_list_get" | "list_get") => Ok(ListRef::Global(
                *self
                    .lists
                    .get(field(b, "list"))
                    .with_context(|| format!("unknown list {}", field(b, "list")))?
                    as u32,
            )),
            Some("script_variables_value") => {
                Ok(ListRef::Local(self.local(field(b, "TEXT")) as u32))
            }
            Some("variables_get") if self.actor_variables.contains_key(field(b, "variable")) => {
                Ok(ListRef::Expression(self.value(b)? as u32))
            }
            Some("variables_get") => match self.target(field(b, "variable")) {
                Target::Local(i) => Ok(ListRef::Local(i as u32)),
                Target::Global(i) => Ok(ListRef::Variable(i as u32)),
            },
            Some(
                "_compiled_value"
                | "text_split"
                | "temporary_list"
                | "list_item"
                | "procedures_2_parameter"
                | "procedures_2_callreturn"
                | "logic_ternary"
                | "self_listen_value",
            ) => Ok(ListRef::Expression(self.value(b)? as u32)),
            _ if self.program.semantics == RuntimeSemantics::Kitten4 => {
                Ok(ListRef::Expression(self.value(b)? as u32))
            }
            _ => bail!("expected list reference at {}", b["id"]),
        }
    }
    fn local(&mut self, name: &str) -> usize {
        if let Some(i) = self.locals.get(name) {
            return *i;
        }
        let i = self.program.local_count;
        self.program.local_count += 1;
        self.locals.insert(name.into(), i);
        i
    }
    fn target(&mut self, name: &str) -> Target {
        if let Ok(v) = serde_json::from_str::<Value>(name)
            && v["type"]
                .as_str()
                .is_some_and(|s| s.starts_with("NEKO_SCRIPT_VARIABLE_TYPE"))
        {
            return Target::Local(self.local(v["name"].as_str().unwrap_or("")));
        }
        Target::Global(self.slot(name))
    }
    fn code_local(&mut self, name: &str) -> usize {
        let index = self.local(name);
        self.program.code_locals.insert(index);
        index
    }
    #[inline]
    fn value(&mut self, b: &Value) -> Result<usize> {
        if !self.compile_work && self.compile_depth >= 32 {
            return self.deep_value(b);
        }
        self.compile_depth += 1;
        let result = self.value_one(b);
        self.compile_depth -= 1;
        result
    }
    fn value_one(&mut self, b: &Value) -> Result<usize> {
        if b["type"] == "_compiled_value" {
            ensure!(self.compile_work, "reserved internal expression type");
            let index = b["index"]
                .as_u64()
                .context("invalid internal expression index")? as usize;
            ensure!(
                index < self.program.values.len(),
                "invalid internal expression index"
            );
            return Ok(index);
        }
        let value = match b["type"].as_str().unwrap_or("") {
            "math_arithmetic"
                if self.program.semantics == RuntimeSemantics::Kitten4
                    && field(b, "type") == "add" =>
            {
                ValueExpr::Kitten4Add(self.value(input(b, "A")?)?, self.value(input(b, "B")?)?)
            }
            "kitten4_calculate" => ValueExpr::Calculate(self.value(input(b, "input")?)?),
            "math_number_property"
                if self.program.semantics == RuntimeSemantics::Kitten4
                    && matches!(field(b, "type"), "integer" | "whole") =>
            {
                ValueExpr::Whole(self.value(input(b, "num")?)?)
            }
            "math_number" if self.program.semantics == RuntimeSemantics::KnCurrent => {
                if let Some(text) = kn_preserved_number_text(b) {
                    self.constant(Cell::Text(text.into()))
                } else {
                    ValueExpr::Number(self.expr(b)?)
                }
            }
            "broadcast_input" => self.constant(Cell::Text(field(b, "message").into())),
            "self_listen_value" => ValueExpr::Payload,
            "procedures_2_parameter" => {
                ValueExpr::Parameter(*self.parameters.get(field(b, "param_name")).with_context(
                    || format!("unknown procedure parameter {}", field(b, "param_name")),
                )?)
            }
            "received_broadcast" => ValueExpr::Received(self.value(input(b, "message")?)?),
            "text_contain" => {
                ValueExpr::Contains(self.value(input(b, "A")?)?, self.value(input(b, "B")?)?)
            }
            "list_index_of" | "list_is_exist" => ValueExpr::Find(
                self.list(input(b, "list")?)?,
                self.value(input(b, "list_item_value")?)?,
                b["type"] == "list_is_exist",
            ),
            "text" => self.constant(Cell::Text(field(b, "TEXT").into())),
            "kitten4_default_value" => {
                let text = field(b, "TEXT");
                let number = k4_number_text(text);
                self.constant(if number.is_nan() {
                    Cell::Text(text.into())
                } else {
                    Cell::Number(number)
                })
            }
            "get_styles" => self.constant(Cell::from_json(&b["fields"]["style_id"])?),
            "kitten4_costume_literal" => {
                let id = self.program.strings.len();
                self.program.strings.push(field(b, "style_id").into());
                ValueExpr::CostumeLiteral(id)
            }
            "kitten4_costume_name" => {
                ValueExpr::CostumeName(self.actor_target(field(b, "sprite"))?)
            }
            "kitten4_check_screen" => ValueExpr::K4Screen(
                self.value(input(b, "screen")?)?,
                field(b, "is_stay") == "true",
            ),
            "get_play_audio" | "get_stop_audio" => {
                self.constant(Cell::from_json(&b["fields"]["audio_id"])?)
            }
            "text_split" => ValueExpr::Split(
                self.value(input(b, "TEXT_TO_SPLIT")?)?,
                self.value(input(b, "SPLIT_TEXT")?)?,
            ),
            "logic_boolean" => {
                self.constant(Cell::Bool(field(b, "BOOL").eq_ignore_ascii_case("true")))
            }
            "logic_empty" if self.program.semantics == RuntimeSemantics::KnCurrent => {
                self.constant(Cell::Bool(false))
            }
            "logic_negate" => ValueExpr::Not(self.value(input(b, "logic")?)?),
            "logic_ternary" => ValueExpr::Ternary(
                self.value(input(b, "condition")?)?,
                self.value(input(b, "ifTrue")?)?,
                self.value(input(b, "ifFalse")?)?,
            ),
            "logic_operation" => ValueExpr::Logic(
                self.value(input(b, "A")?)?,
                self.value(input(b, "B")?)?,
                field(b, "type") == "and",
            ),
            "logic_compare" => {
                let op = match field(b, "OP") {
                    "EQ" => Binary::Eq,
                    "NEQ" => Binary::Ne,
                    "LT" => Binary::Lt,
                    "LTE" => Binary::Le,
                    "GT" => Binary::Gt,
                    "GTE" => Binary::Ge,
                    other => bail!("unknown comparison {other}"),
                };
                ValueExpr::Compare(self.value(input(b, "A")?)?, self.value(input(b, "B")?)?, op)
            }
            "variables_get" => {
                if let Some(&slot) = self.actor_variables.get(field(b, "variable")) {
                    ValueExpr::ActorVariable(usize::MAX, slot, None)
                } else if let Some(i) = self.lists.get(field(b, "variable")) {
                    ValueExpr::List(ListRef::Global(*i as u32))
                } else {
                    match self.target(field(b, "variable")) {
                        Target::Global(i) => ValueExpr::Global(i),
                        Target::Local(i) => ValueExpr::Local(i),
                    }
                }
            }
            "kitten4_actor_variable" => ValueExpr::ActorVariable(
                self.actor_target(field(b, "sprite"))?,
                *self
                    .actor_variables
                    .get(field(b, "attribute"))
                    .context("unknown private variable attribute")?,
                None,
            ),
            "script_variables_value" => ValueExpr::Local(self.local(field(b, "TEXT"))),
            // 参考 HateNeko 0.7.1 的 rt/impl/data.lua::_variable_get。
            "_variable_get" => ValueExpr::Local(self.code_local(field(b, "VAR"))),
            // 参考 HateNeko 0.7.1 的 rt/impl/math.lua::logic_to_boolean。
            "logic_to_boolean" => ValueExpr::Boolean(self.value(input(b, "VALUE")?)?),
            // 参考 HateNeko 0.7.1 的 rt/impl/js.lua::atob/btoa/parseInt/parseFloat。
            "atob" => ValueExpr::Decode64(self.value(input(b, "encoded")?)?),
            "btoa" => ValueExpr::Encode64(self.value(input(b, "data")?)?),
            "parseFloat" => ValueExpr::ParseFloat(self.value(input(b, "str")?)?),
            "parseInt" => {
                // Official editor: radix is a dropdown field, not a socket.
                let radix = self.push_constant(Cell::Number(
                    number(&b["fields"]["radix"]).unwrap_or(f64::NAN),
                ));
                ValueExpr::ParseInt(self.value(input(b, "str")?)?, radix)
            }
            // 参考 HateNeko 0.7.1 的 rt/impl/js.lua::isNaN/isFinite。
            // Official main.8ccf2442.js uses Number predicates (no coercion),
            // unlike HateNeko's V.js_num fallback for non-number values.
            "isNaN" => ValueExpr::IsNumber(self.value(input(b, "value")?)?, false),
            "isFinite" => ValueExpr::IsNumber(self.value(input(b, "value")?)?, true),
            "pure_list_get" | "list_get" => ValueExpr::List(self.list(b)?),
            "kitten4_is_ranking_show_hide" => ValueExpr::Ranking(field(b, "VAL") == "show"),
            "kitten4_cloud_list_item" => ValueExpr::CloudItem(
                self.list(input(b, "list")?)?,
                if field(b, "item") == "last" {
                    None
                } else {
                    Some(self.arg(b, "list_index")?)
                },
            ),
            "list_item" => ValueExpr::Item(
                self.list(input(b, "list")?)?,
                if field(b, "item") == "last" {
                    None
                } else {
                    Some(self.arg(b, "list_index")?)
                },
            ),
            "temporary_list" | "text_join" => {
                let temporary = b["type"] == "temporary_list";
                let prefix = if temporary { "ITEM" } else { "ADD" };
                let mut items = b["inputs"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter_map(|(k, v)| {
                        k.strip_prefix(prefix)?
                            .parse::<usize>()
                            .ok()
                            .map(|i| (i, v))
                    })
                    .collect::<Vec<_>>();
                items.sort_by_key(|(i, _)| *i);
                let values = items
                    .into_iter()
                    .map(|(_, b)| self.value(b))
                    .collect::<Result<Vec<_>>>()?;
                let span = Span {
                    start: self.program.value_args.len() as u32,
                    len: values.len() as u32,
                };
                self.program.value_args.extend(values);
                if temporary {
                    ValueExpr::Temporary(span)
                } else {
                    ValueExpr::Join(span)
                }
            }
            "get_answer" => ValueExpr::Answer,
            "current_scene_id" => ValueExpr::SceneId,
            "shadow_text" => match b["inputs"].get("text") {
                Some(text) => return self.value(text),
                None => self.constant(Cell::Text(field(b, "TEXT").into())),
            },
            "on_bump_actor_value" => ValueExpr::BumpProperty(
                bump_attribute(field(b, "attribute")).with_context(|| {
                    format!(
                        "unsupported collision attribute {} at {}",
                        field(b, "attribute"),
                        b["id"]
                    )
                })?,
            ),
            "get_screens" => self.constant(Cell::Text(
                b["fields"]
                    .get("screen_id")
                    .or_else(|| b["fields"].get("screen"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into(),
            )),
            "get_choice_and_index" => ValueExpr::Choice(field(b, "type") == "index"),
            "get_clone_index_property" => {
                if let Some(&slot) = self.actor_variables.get(field(b, "attribute")) {
                    let target = self.actor_target(field(b, "sprite"))?;
                    let index = self.arg(b, "index")?;
                    let value = self.program.values.len();
                    self.program
                        .values
                        .push(ValueExpr::ActorVariable(target, slot, Some(index)));
                    return Ok(value);
                }
                let attribute = match field(b, "attribute") {
                    "0" | "x" => 0,
                    "1" | "y" => 1,
                    "2" => 2,
                    "4" => 4,
                    attribute @ ("3" | "5" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "16"
                    | "17")
                        if self.program.semantics == RuntimeSemantics::Kitten4 =>
                    {
                        attribute.parse::<u8>()?
                    }
                    other => bail!("unsupported clone attribute {other} at {}", b["id"]),
                };
                ValueExpr::CloneProperty(
                    self.actor_target(field(b, "sprite"))?,
                    self.arg(b, "index")?,
                    attribute,
                )
            }
            "procedures_2_callreturn" => {
                let (procedure, args) = self.call_arguments(b)?;
                // Reporter calls run to completion inside one evaluation: use the
                // warp-compiled body so loops do not yield.
                ValueExpr::CallReturn(procedure + 1, args)
            }
            "text_select" => {
                let text = self.value(input(b, "text")?)?;
                let start = self.arg(b, "start_index")?;
                let single = self.program.semantics == RuntimeSemantics::KnCurrent
                    && b["inputs"].get("end_index").is_none();
                let end = if single {
                    self.expr(&serde_json::json!({"type":"math_number","fields":{"NUM":0}}))?
                } else {
                    self.arg(b, "end_index")?
                };
                // Compile children first: their value indices must not be
                // mistaken for this Select. Do not duplicate a dynamic start.
                if single {
                    self.program
                        .single_text_selects
                        .insert(self.program.values.len());
                }
                ValueExpr::Select(text, start, end)
            }
            "get_time"
                if b["fields"]
                    .get("op")
                    .or_else(|| b["fields"].get("time"))
                    .and_then(Value::as_str)
                    == Some("week") =>
            {
                ValueExpr::WeekText
            }
            "convert_type" => {
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    let conversion = match field(b, "type") {
                        "number" => 0,
                        "string" => 1,
                        "boolean" => 2,
                        other => bail!("unsupported conversion {other}"),
                    };
                    let value = self.value(input(b, "text")?)?;
                    let i = self.program.values.len();
                    self.program
                        .values
                        .push(ValueExpr::Kitten4Convert(value, conversion));
                    return Ok(i);
                }
                ensure!(
                    matches!(field(b, "type"), "number" | "string"),
                    "unsupported conversion {}",
                    field(b, "type")
                );
                ValueExpr::Convert(self.value(input(b, "text")?)?, field(b, "type") == "number")
            }
            _ => ValueExpr::Number(self.expr(b)?),
        };
        let i = self.program.values.len();
        self.program.values.push(value);
        Ok(i)
    }
    fn push_constant(&mut self, value: Cell) -> usize {
        let constant = self.constant(value);
        self.program.values.push(constant);
        self.program.values.len() - 1
    }
    fn constant(&mut self, value: Cell) -> ValueExpr {
        self.program.constants.push(value);
        ValueExpr::Constant(self.program.constants.len() - 1)
    }
    /// Resolves a procedure call: (definition base index, argument list index).
    fn call_arguments(&mut self, b: &Value) -> Result<(usize, usize)> {
        let id = crate::runtime::helpers::procedure_def_id(b)
            .or_else(|| b["fields"]["NAME"].as_str())
            .context("procedure call has no definition ID")?;
        let base = *self
            .procedures
            .get(id)
            .with_context(|| format!("unknown procedure {id}"))?;
        let params = self.procedure_params[&base].clone();
        let args = params
            .iter()
            .map(|param| {
                if self.program.semantics == RuntimeSemantics::KnCurrent {
                    self.kn_procedure_argument(b, param)
                } else {
                    // K4 keeps its existing strict connected-input policy.
                    self.value(input(b, &param.id)?)
                }
            })
            .collect::<Result<Vec<_>>>()?;
        ensure!(
            b["inputs"].as_object().is_none_or(|inputs| inputs
                .keys()
                .all(|key| params.iter().any(|param| &param.id == key))),
            "unknown procedure call input at {}",
            b["id"]
        );
        self.program.call_arguments.push(args);
        Ok((base, self.program.call_arguments.len() - 1))
    }
    fn kn_procedure_argument(&mut self, b: &Value, param: &ProcedureParam) -> Result<usize> {
        let connected = b["inputs"].get(&param.id);
        if param.kind == "Custom" {
            ensure!(
                connected.is_none(),
                "KN Custom parameter {} has no value socket at {}",
                param.id,
                b["id"]
            );
            ensure!(
                b["shadows"].get(&param.id).is_none(),
                "unsupported KN Custom parameter shadow {} at {}",
                param.id,
                b["id"]
            );
            let options = param.options.as_array().with_context(|| {
                format!("KN Custom parameter {} requires string options", param.id)
            })?;
            ensure!(
                !options.is_empty() && options.iter().all(Value::is_string),
                "KN Custom parameter {} requires nonempty string options",
                param.id
            );
            // Presence, not truthiness: valid empty/"0"/"false" selections are
            // text, not missing values, booleans or option indices.
            let selected = b["fields"].get(&param.id).unwrap_or(&options[0]);
            let text = selected.as_str().with_context(|| {
                format!("KN Custom parameter {} requires a string field", param.id)
            })?;
            ensure!(
                options.iter().any(|option| option.as_str() == Some(text)),
                "KN Custom parameter {} has an undeclared option at {}",
                param.id,
                b["id"]
            );
            return Ok(self.push_constant(Cell::Text(text.into())));
        }
        if let Some(value) = connected {
            // Compile once; the existing argument list evaluates each entry
            // once per call, in declaration order, in both call forms.
            return self.value(value);
        }
        // A stored shadow is not absence. XML materialization is a separate
        // contract; never silently discard one and substitute a default.
        ensure!(
            b["shadows"].get(&param.id).is_none(),
            "unsupported KN procedure shadow-only argument {} at {}",
            param.id,
            b["id"]
        );
        match param.kind.as_str() {
            "String" | "Number" => Ok(self.push_constant(Cell::Number(0.0))),
            "Boolean" => Ok(self.push_constant(Cell::Bool(false))),
            _ => self.value(input(b, &param.id)?),
        }
    }
    fn text(&mut self, b: &Value) -> Result<usize> {
        let mut parts = vec![];
        self.text_parts(b, &mut parts, 0)?;
        let index = self.program.texts.len();
        self.program.texts.push(parts);
        Ok(index)
    }
    fn text_parts(&mut self, b: &Value, parts: &mut Vec<TextPart>, depth: usize) -> Result<()> {
        let mut pending = vec![b];
        while let Some(b) = pending.pop() {
            match b["type"].as_str() {
                Some("text") => {
                    let index = self.program.strings.len();
                    self.program.strings.push(field(b, "TEXT").into());
                    parts.push(TextPart::Literal(index));
                }
                Some("text_join") => {
                    let mut inputs = b["inputs"]
                        .as_object()
                        .into_iter()
                        .flatten()
                        .filter_map(|(name, v)| {
                            name.strip_prefix("ADD")?
                                .parse::<usize>()
                                .ok()
                                .map(|i| (i, v))
                        })
                        .collect::<Vec<_>>();
                    inputs.sort_by_key(|(i, _)| *i);
                    pending.extend(inputs.into_iter().rev().map(|(_, value)| value));
                }
                _ => parts.push(TextPart::Value(self.value(b)?)),
            }
        }
        let _ = depth;
        Ok(())
    }
    fn slot(&mut self, id: &str) -> usize {
        if let Some(slot) = self.slots.get(id) {
            return *slot;
        }
        let slot = self.program.initial.len();
        self.program.initial.push(0.0);
        self.program.initial_values.push(None);
        self.program.variable_names.push(id.into());
        self.slots.insert(id.into(), slot);
        slot
    }
    fn emit(&mut self, op: Op, block: &Value) -> usize {
        let pc = self.program.ops.len();
        self.program.ops.push(op);
        self.program
            .sources
            .push(block["id"].as_str().unwrap_or("?").into());
        pc
    }
    #[inline]
    fn expr(&mut self, block: &Value) -> Result<Expr> {
        if !self.compile_work && self.compile_depth >= 32 {
            let value = self.deep_value(block)?;
            self.program.expressions.push(ExprOp::Value(value));
            return Ok(Expr {
                end: self.program.expressions.len() as u32,
            });
        }
        self.compile_depth += 1;
        let result = self.expr_one(block);
        self.compile_depth -= 1;
        result
    }
    fn expr_one(&mut self, block: &Value) -> Result<Expr> {
        let outer = std::mem::take(&mut self.expression_work);
        self.expression(block, 0)?;
        let start = self.program.expressions.len();
        self.program.expressions.append(&mut self.expression_work);
        self.expression_work = outer;
        // Fold only fully constant expressions; no cross-statement propagation.
        let slice = &self.program.expressions[start..];
        if slice.iter().all(|op| {
            matches!(
                op,
                ExprOp::Constant(_) | ExprOp::Binary(_) | ExprOp::Unary(_)
            )
        }) {
            let mut stack = Vec::with_capacity(16);
            for op in slice {
                match *op {
                    ExprOp::Constant(n) => stack.push(n),
                    ExprOp::Binary(op) => {
                        let b = stack.pop().unwrap();
                        let a = stack.pop().unwrap();
                        stack.push(op.apply(a, b));
                    }
                    ExprOp::Unary(op) => {
                        let a = stack.pop().unwrap();
                        stack.push(op.apply(a));
                    }
                    _ => unreachable!(),
                }
            }
            let n = stack[0];
            if n.is_finite() {
                self.program.expressions.truncate(start);
                self.program.expressions.push(ExprOp::Constant(n));
            }
        }
        ensure!(
            self.program.expressions.len() < u32::MAX as usize,
            "too many expression operations"
        );
        Ok(Expr {
            end: self.program.expressions.len() as u32,
        })
    }
    fn arg(&mut self, block: &Value, key: &str) -> Result<Expr> {
        self.expr(input(block, key)?)
    }
    fn condition(&mut self, block: &Value) -> Result<Expr> {
        let value = self.value(block)?;
        let start = self.program.expressions.len();
        self.program.expressions.push(ExprOp::Truth(value));
        ensure!(
            start < u32::MAX as usize - 1,
            "too many expression operations"
        );
        Ok(Expr {
            end: start as u32 + 1,
        })
    }
    fn expression_value(&mut self, b: &Value) -> Result<()> {
        let value = self.value(b)?;
        self.expression_work.push(ExprOp::Value(value));
        Ok(())
    }
    fn expression(&mut self, b: &Value, depth: usize) -> Result<()> {
        // Compile ordinary numeric trees without allocating a traversal stack.
        // Recursion is strictly bounded, even for synthesized/proxy reporters.
        if depth < 32 {
            for key in self.expression_inputs(b) {
                self.expression(input(b, key)?, depth + 1)?;
            }
            return self.expression_one(b, depth);
        }
        let mut work = vec![(b, false)];
        while let Some((node, exit)) = work.pop() {
            if exit {
                self.expression_one(node, depth)?;
                continue;
            }
            work.push((node, true));
            for key in self.expression_inputs(node).iter().rev() {
                work.push((input(node, key)?, false));
            }
        }
        Ok(())
    }
    fn expression_inputs(&self, node: &Value) -> &'static [&'static str] {
        match node["type"].as_str().unwrap_or("") {
            // K4 ADD consumes typed values. As with whole below, value() owns
            // its children; numeric traversal must not compile/evaluate them twice.
            "math_arithmetic"
                if self.program.semantics == RuntimeSemantics::Kitten4
                    && field(node, "type") == "add" =>
            {
                &[]
            }
            "random_num" | "math_arithmetic" | "math_modulo" | "math_arithmetic_power" => {
                &["A", "B"]
            }
            "divisible_by" if node["inputs"].get("NUMBER_TO_CHECK").is_some() => {
                &["NUMBER_TO_CHECK", "DIVISOR"]
            }
            "divisible_by" => &["A", "B"],
            // K4 whole checks the typed value, not a numeric operand. Its
            // input is compiled by value(); do not leave a duplicate postfix
            // operand (or evaluate a reporter twice).
            "math_number_property"
                if self.program.semantics == RuntimeSemantics::Kitten4
                    && matches!(field(node, "type"), "integer" | "whole") =>
            {
                &[]
            }
            "math_number_property" if node["inputs"].get("NUMBER_TO_CHECK").is_some() => {
                &["NUMBER_TO_CHECK"]
            }
            "math_number_property" | "math_arc_trig" | "math_trig_rad" => &["num"],
            "math_function" | "math_round" | "math_trig" if node["inputs"].get("num").is_none() => {
                &["NUM"]
            }
            "math_function" | "math_round" | "math_trig" => &["num"],
            "list_item"
                if self.program.semantics == RuntimeSemantics::KnCurrent
                    && field(node, "item") != "last" =>
            {
                &["list_index"]
            }
            _ => &[],
        }
    }
    fn expression_one(&mut self, b: &Value, _depth: usize) -> Result<()> {
        let kind = b["type"].as_str().unwrap_or("");
        // Slider/dial/servo number shadows carry the same NUM field.
        let kind = if kind.starts_with("math_number_with_") || kind == "math_number_not_allow_text"
        {
            "math_number"
        } else {
            kind
        };
        let op = match kind {
            "math_number" => {
                let value = b["fields"].get("NUM").or_else(|| b["fields"].get("TEXT"));
                ExprOp::Constant(
                    value
                        .and_then(number)
                        .with_context(|| format!("invalid number at block {}", b["id"]))?,
                )
            }
            "logic_boolean" => {
                ExprOp::Constant(field(b, "BOOL").eq_ignore_ascii_case("true") as u8 as f64)
            }
            "variables_get" => {
                if self.actor_variables.contains_key(field(b, "variable")) {
                    return self.expression_value(b);
                }
                ensure!(
                    !self.lists.contains_key(field(b, "variable")),
                    "list used as scalar at {}",
                    b["id"]
                );
                match self.target(field(b, "variable")) {
                    Target::Global(i) => ExprOp::Slot(i),
                    Target::Local(i) => ExprOp::Local(i),
                }
            }
            "script_variables_value" => ExprOp::Local(self.local(field(b, "TEXT"))),
            "get_mouse_info" => {
                ensure!(
                    matches!(field(b, "type"), "x" | "y"),
                    "unsupported mouse information at {}",
                    b["id"]
                );
                ExprOp::Mouse(field(b, "type") == "y")
            }
            "text_length" => ExprOp::TextLength(self.value(input(b, "text")?)?),
            "random_num" => ExprOp::Random,
            "_compiled_value" => {
                let index = self.value(b)?;
                match self.program.values[index] {
                    ValueExpr::Number(expr)
                        if matches!(
                            self.program.expressions[expr.end as usize - 1],
                            ExprOp::Constant(_)
                        ) =>
                    {
                        self.program.expressions[expr.end as usize - 1]
                    }
                    _ => ExprOp::Value(index),
                }
            }
            "text"
            | "kitten4_default_value"
            | "text_join"
            | "text_select"
            | "convert_type"
            | "_variable_get"
            | "logic_to_boolean"
            | "atob"
            | "btoa"
            | "parseInt"
            | "parseFloat"
            | "isNaN"
            | "isFinite"
            | "self_listen_value"
            | "procedures_2_parameter"
            | "received_broadcast"
            | "text_contain"
            | "list_index_of"
            | "list_is_exist" => ExprOp::Value(self.value(b)?),
            "logic_compare"
            | "logic_operation"
            | "logic_negate"
            | "logic_ternary"
            | "procedures_2_callreturn"
            | "get_answer"
            | "current_scene_id"
            | "kitten4_costume_literal"
            | "kitten4_costume_name"
            | "kitten4_calculate"
            | "kitten4_check_screen"
            | "get_choice_and_index" => ExprOp::Value(self.value(b)?),
            "check_key" => {
                ensure!(
                    matches!(field(b, "type"), "down" | "up"),
                    "unsupported key check"
                );
                let i = self.program.strings.len();
                self.program.strings.push(field(b, "key").into());
                ExprOp::Key(i, field(b, "type") == "down")
            }
            "traverse_number_value" => ExprOp::Range(
                self.ranges
                    .iter()
                    .rev()
                    .position(|n| n == field(b, "TEXT"))
                    .context("range value outside its loop")?,
            ),
            "list_length" => ExprOp::ListLength(self.list(input(b, "list")?)?),
            "kitten4_cloud_list_item" => ExprOp::Value(self.value(b)?),
            "kitten4_is_ranking_show_hide" => ExprOp::Value(self.value(b)?),
            "list_item" if self.program.semantics == RuntimeSemantics::Kitten4 => {
                ExprOp::Value(self.value(b)?)
            }
            "list_item" => {
                let list = self.list(input(b, "list")?)?;
                let last = field(b, "item") == "last";
                ExprOp::ListItem(list, last)
            }
            "self_get_position_x" => ExprOp::X,
            "self_get_position_y" => ExprOp::Y,
            "self_get_rotation" => ExprOp::Direction,
            "timer" => ExprOp::Timer,
            "coordinate_of_sprite" => {
                ensure!(
                    matches!(field(b, "coordinate"), "x" | "y"),
                    "unknown coordinate reporter"
                );
                ExprOp::Coordinate(
                    self.actor_target(field(b, "sprite"))?,
                    field(b, "coordinate") == "y",
                )
            }
            // Native get_orientation is device tilt, not sprite rotation.
            // Like the official desktop runtime, this player reports zero.
            "get_orientation" => ExprOp::Constant(0.0),
            "appearance_of_sprite" => {
                let target = self.actor_target(field(b, "sprite"))?;
                match field(b, "appearance") {
                    "direction" => ExprOp::Orientation(target),
                    "scale" | "width" | "height" => ExprOp::Scale(target),
                    other => bail!("unsupported appearance reporter {other}"),
                }
            }
            "style_of_sprite" => ExprOp::Costume(self.actor_target(field(b, "sprite"))?),
            "physics2_get_property" => {
                ExprOp::PhysicsProperty(physics::Property::parse(field(b, "property"))?)
            }
            "distance_to" => ExprOp::Distance(self.point_target(field(b, "sprite"))?),
            "get_clone_num" => ExprOp::CloneCount(self.actor_target(field(b, "sprite"))?),
            "bump_into" => {
                let other = b["fields"]
                    .get("sprite1")
                    .or_else(|| b["fields"].get("target"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let other = match other {
                    "--mouse" | "__mouse" | "--pointer" | "__pointer" => TARGET_MOUSE,
                    id => match edge_target(id).or_else(|| camp_target(id)) {
                        Some(target) => target,
                        None => self.actor_target(id)?,
                    },
                };
                let subject = field(b, "sprite");
                let subject = match camp_target(subject) {
                    Some(camp) => camp,
                    None => self.actor_target(subject)?,
                };
                ExprOp::Touching(subject, other)
            }
            "bump_into_color" => {
                let subject = field(b, "sprite");
                let subject = match camp_target(subject) {
                    Some(camp) => camp,
                    None => self.actor_target(subject)?,
                };
                let color = field(b, "color").trim_start_matches('#');
                let color = u32::from_str_radix(color, 16)
                    .ok()
                    .filter(|_| color.len() == 6)
                    .with_context(|| {
                        format!("invalid colour {} at {}", field(b, "color"), b["id"])
                    })?;
                self.program.uses_color = true;
                ExprOp::TouchingColor(subject, color)
            }
            "out_of_boundary" => {
                let subject = b["fields"]
                    .get("sprite")
                    .and_then(Value::as_str)
                    .unwrap_or("--self");
                ExprOp::OutOfBounds(
                    self.actor_target(subject)?,
                    match field(b, "boundary") {
                        "" | "any" | "all" | "edge" => 0,
                        "top" | "up" => 1,
                        "bottom" | "down" => 2,
                        "left" => 3,
                        "right" => 4,
                        other => bail!("unknown boundary {other} at {}", b["id"]),
                    },
                )
            }
            "get_current_clone_index" => ExprOp::CloneIndex,
            "get_clone_index_property"
            | "kitten4_actor_variable"
            | "shadow_text"
            | "on_bump_actor_value" => ExprOp::Value(self.value(b)?),
            "get_stage_info" => {
                let info = b["fields"].get("info").or_else(|| b["fields"].get("type"));
                match info.and_then(Value::as_str).unwrap_or("width") {
                    "width" => ExprOp::Constant(self.program.width),
                    "height" => ExprOp::Constant(self.program.height),
                    other => bail!("unsupported stage information {other}"),
                }
            }
            "get_time" => {
                let unit = b["fields"].get("op").or_else(|| b["fields"].get("time"));
                ExprOp::Time(match unit.and_then(Value::as_str).unwrap_or("") {
                    "year" => 0,
                    "month" => 1,
                    "date" | "day" => 2,
                    "week" => return self.expression_value(b),
                    "week_num" => 4,
                    "hour" => 5,
                    "minute" => 6,
                    "second" => 7,
                    other => bail!("unsupported time unit {other} at {}", b["id"]),
                })
            }
            "effect_of_sprite" => {
                let scope = effect_scope(field(b, "effect"))
                    .with_context(|| format!("unsupported effect at {}", b["id"]))?;
                ExprOp::Effect(self.actor_target(field(b, "sprite"))?, scope)
            }
            "mouse_down" => ExprOp::MouseDown(
                match b["fields"]
                    .get("mouse_event_type")
                    .or_else(|| b["fields"].get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("down")
                {
                    "down" => 0,
                    "click" => 1,
                    "up" => 2,
                    other => bail!("unsupported mouse state {other}"),
                },
            ),
            "kitten4_legacy_property" => ExprOp::LegacyPhysicsProperty(
                self.actor_target(field(b, "sprite"))?,
                physics::Property::parse(field(b, "attribute"))?,
            ),
            "divisible_by" => ExprOp::Binary(Binary::Divisible),
            "math_number_property" => {
                if self.program.semantics == RuntimeSemantics::Kitten4
                    && matches!(field(b, "type"), "integer" | "whole")
                {
                    return self.expression_value(b);
                }
                let property = b["fields"]
                    .get("PROPERTY")
                    .or_else(|| b["fields"].get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                ExprOp::Unary(match property.to_ascii_lowercase().as_str() {
                    "even" => Unary::Even,
                    "odd" => Unary::Odd,
                    "prime" => Unary::Prime,
                    "whole" | "integer" => Unary::Whole,
                    "positive" => Unary::Positive,
                    "negative" => Unary::Negative,
                    other => bail!("unsupported number property {other}"),
                })
            }
            "math_arithmetic" | "math_modulo" => {
                if kind == "math_arithmetic"
                    && self.program.semantics == RuntimeSemantics::Kitten4
                    && field(b, "type") == "add"
                {
                    return self.expression_value(b);
                }
                let name = if kind == "logic_compare" {
                    field(b, "OP")
                } else if kind == "math_modulo" {
                    "mod"
                } else {
                    field(b, "type")
                };
                ExprOp::Binary(match name {
                    "add" => Binary::Add,
                    "minus" | "subtract" => Binary::Sub,
                    "multiply" => Binary::Mul,
                    "divide" => Binary::Div,
                    "mod" => Binary::Mod,
                    "power" => Binary::Pow,
                    "EQ" => Binary::Eq,
                    "NEQ" => Binary::Ne,
                    "LT" => Binary::Lt,
                    "LTE" => Binary::Le,
                    "GT" => Binary::Gt,
                    "GTE" => Binary::Ge,
                    "and" => Binary::And,
                    "or" => Binary::Or,
                    _ => bail!("unsupported numeric operator {name}"),
                })
            }
            "math_arithmetic_power" => ExprOp::Binary(Binary::Pow),
            "math_arc_trig" | "math_trig_rad" => {
                let radians = kind == "math_trig_rad";
                ExprOp::Unary(match (field(b, "type"), radians) {
                    ("asin", false) => Unary::Asin,
                    ("acos", false) => Unary::Acos,
                    ("atan", false) => Unary::Atan,
                    ("sin", true) => Unary::RSin,
                    ("cos", true) => Unary::RCos,
                    ("tan", true) => Unary::RTan,
                    ("asin", true) => Unary::RAsin,
                    ("acos", true) => Unary::RAcos,
                    ("atan", true) => Unary::RAtan,
                    (other, _) => bail!("unsupported {kind} {other} at {}", b["id"]),
                })
            }
            "math_function" | "math_round" | "math_trig" => {
                // Kitten 4 style math_round uses NUM / OP.
                let name = match field(b, "OP") {
                    "ROUND" => "round",
                    "ROUNDUP" => "round_up",
                    "ROUNDDOWN" => "round_down",
                    _ => field(b, "type"),
                };
                ExprOp::Unary(match name {
                    "0" | "sqrt" => Unary::Sqrt,
                    "1" | "abs" => Unary::Abs,
                    "2" | "neg" => Unary::Neg,
                    "floor" | "round_down" => Unary::Floor,
                    "ceil" | "round_up" => Unary::Ceil,
                    "round" => Unary::Round,
                    "sin" => Unary::Sin,
                    "cos" => Unary::Cos,
                    "tan" => Unary::Tan,
                    "asin" => Unary::Asin,
                    "acos" => Unary::Acos,
                    "atan" => Unary::Atan,
                    "not" => Unary::Not,
                    "3" | "ln" => Unary::Ln,
                    "4" | "log" | "log10" => Unary::Log,
                    "5" | "exp" => Unary::Exp,
                    "6" | "pow10" => Unary::Pow10,
                    _ => bail!("unsupported unary operator {name}"),
                })
            }
            _ => bail!("unsupported expression {kind} at block {}", b["id"]),
        };
        self.expression_work.push(op);
        Ok(())
    }
    fn scripts(&mut self, owner: &Value, actor: usize) -> Result<()> {
        if self.program.semantics == RuntimeSemantics::Kitten4 {
            let mut pending = vec![owner];
            while let Some(value) = pending.pop() {
                match value {
                    Value::Object(object) => {
                        if let Some(kind) = object.get("type").and_then(Value::as_str) {
                            if kind == "kitten4_legacy_self_enable_physics" {
                                self.program
                                    .legacy_physics_scenes
                                    .insert(self.program.sprites[actor].scene);
                            }
                            if kind.starts_with("physics2_") {
                                self.program.has_modern_physics = true;
                            }
                        }
                        pending.extend(object.values());
                    }
                    Value::Array(items) => pending.extend(items),
                    _ => {}
                }
            }
        }
        for root in owner["nekoBlockJsonList"].as_array().into_iter().flatten() {
            let kind = root["type"].as_str().unwrap_or("");
            let event = match kind {
                "when" if self.program.semantics == RuntimeSemantics::KnCurrent => {
                    ScriptEvent::KnWhen
                }
                "self_listen" | "self_listen_with_param" => ScriptEvent::Broadcast(
                    self.value(input(root, "message")?)?,
                    kind == "self_listen_with_param",
                ),
                "on_running_group_activated" | "start_on_click" => {
                    let sprite = &self.program.sprites[actor];
                    let key = (
                        sprite.stage,
                        sprite.id.clone(),
                        root["id"].as_str().unwrap_or("").to_owned(),
                    );
                    match self.start_hats.get(&key) {
                        Some(crate::kitten4::StartKind::Global) => ScriptEvent::K4GlobalStart,
                        Some(crate::kitten4::StartKind::Activation) => ScriptEvent::K4SceneActivate,
                        // New canonical roots and VM-generated hats retain the
                        // scene-bound policy; type alone is not provenance.
                        None => ScriptEvent::Start,
                    }
                }
                "start_as_a_mirror" | "start_as_clone" => ScriptEvent::CloneStart,
                "on_swipe" => {
                    let direction = field(root, "type");
                    ensure!(
                        matches!(direction, "up" | "down" | "left" | "right"),
                        "unknown swipe direction {direction} at {}",
                        root["id"]
                    );
                    ScriptEvent::Swipe(direction.into())
                }
                "backdrop_on_change" => ScriptEvent::K4Backdrop(field(root, "sprite").into()),
                "on_keydown" => {
                    ensure!(
                        matches!(field(root, "type"), "down" | "up"),
                        "unknown key state at {}",
                        root["id"]
                    );
                    ScriptEvent::Key(field(root, "key").into(), field(root, "type") == "down")
                }
                "on_bump_actor" => {
                    let kind = match field(root, "type") {
                        "start" => 0,
                        "move" => 1,
                        "end" => 2,
                        other => bail!("unknown collision phase {other} at {}", root["id"]),
                    };
                    let target = field(root, "sprite");
                    ensure!(
                        !matches!(target, "--self" | "__self" | ""),
                        "collision hat needs another actor at {}",
                        root["id"]
                    );
                    ScriptEvent::Bump(self.actor_target(target)?, kind)
                }
                "sprite_on_tap" => {
                    let state = field(root, "type");
                    ensure!(
                        matches!(state, "mouse_click" | "mouse_down" | "mouse_up"),
                        "unsupported pointer event {state} at {}",
                        root["id"]
                    );
                    let target = match field(root, "sprite") {
                        "--self" => self.program.sprites[actor].id.clone(),
                        "--screen" => "--screen".into(),
                        id if self.actor_target(id).is_ok() => id.into(),
                        id => bail!("unknown pointer target {id} at {}", root["id"]),
                    };
                    ScriptEvent::Pointer(target, state.into())
                }
                // Official KN leaves disconnected statement stacks dormant.
                // Keep this explicit and provenance-scoped: unknown event hats
                // and unsupported blocks inside executable bodies still fail.
                "mirror"
                | "procedures_2_callnoreturn"
                | "wait_until"
                | "self_gradually_show_hide"
                | "set_scale"
                    if self.program.semantics == RuntimeSemantics::KnCurrent =>
                {
                    continue;
                }
                // Loose workspace stacks/reporters are not executable scripts. Unknown
                // event hats must still be diagnosed, not silently discarded.
                _ if root["is_output"] == true
                    || (kind == "kitten4_noop"
                        && self.program.semantics == RuntimeSemantics::Kitten4)
                    || matches!(
                        kind,
                        "variables_set"
                            | "change_variables"
                            | "script_variables"
                            | "convert_type"
                            | "traverse_number_value"
                            | "variables_get"
                    ) =>
                {
                    continue;
                }
                _ => bail!(
                    "unsupported root {kind} in {} (block {})",
                    owner["name"],
                    root["id"]
                ),
            };
            let start = self.program.ops.len();
            if matches!(event, ScriptEvent::KnWhen) {
                let condition = self.condition(input(root, "condition")?)?;
                self.emit(Op::WaitUntil(condition), root);
                self.chain(root["statements"].get("DO"), false)
                    .with_context(|| format!("owner {}", owner["name"]))?;
                // Both false checks and completed bodies yield. The same task
                // retains its pc/call/loop/wake state while DO is in flight.
                self.emit(Op::Yield, root);
                self.emit(Op::Jump(start), root);
                self.program.scripts.push(Script {
                    start,
                    hat: root["id"].as_str().unwrap_or("").into(),
                    actor,
                    event,
                });
                continue;
            }
            let body = if matches!(event, ScriptEvent::Broadcast(_, _)) {
                root["statements"].get("DO")
            } else if matches!(event, ScriptEvent::Pointer(..))
                && self.program.semantics == RuntimeSemantics::Kitten4
            {
                root["statements"].get("DO").or(root.get("next"))
            } else if matches!(
                event,
                ScriptEvent::CloneStart
                    | ScriptEvent::Swipe(_)
                    | ScriptEvent::Bump(..)
                    | ScriptEvent::Pointer(..)
                    | ScriptEvent::K4Backdrop(_)
            ) {
                root["statements"]
                    .get("DO")
                    .filter(|b| b.is_object())
                    .or(root.get("next"))
            } else {
                root.get("next")
            };
            self.chain(body, false)
                .with_context(|| format!("owner {}", owner["name"]))?;
            self.emit(Op::Halt, root);
            self.program.scripts.push(Script {
                start,
                hat: root["id"].as_str().unwrap_or("").into(),
                actor,
                event,
            });
        }
        Ok(())
    }
    /// Actor index, or the mouse/random point targets used by face/move blocks.
    fn point_target(&self, id: &str) -> Result<usize> {
        match id {
            "--mouse" | "__mouse" | "--pointer" | "__pointer" => Ok(TARGET_MOUSE),
            "--random" | "__random" => Ok(TARGET_RANDOM),
            id => self.actor_target(id),
        }
    }
    /// Value input under any of the native socket names (KN and Kitten 4 differ).
    fn arg_any(&mut self, block: &Value, keys: &[&str]) -> Result<Expr> {
        for key in keys {
            if let Some(v) = block.get("inputs").and_then(|m| m.get(*key)) {
                return self.expr(v);
            }
        }
        bail!("{}: missing input {}", block["type"], keys.join("/"))
    }
    /// Value input negated when the native `increase` field says decrease.
    fn signed_arg(&mut self, block: &Value, keys: &[&str]) -> Result<Expr> {
        let mut e = self.arg_any(block, keys)?;
        if field(block, "increase") == "decrease" || field(block, "method") == "decrease" {
            self.program.expressions.push(ExprOp::Unary(Unary::Neg));
            e.end += 1;
        }
        Ok(e)
    }
    fn actor_target(&self, id: &str) -> Result<usize> {
        if matches!(id, "--self" | "__self" | "") {
            return Ok(usize::MAX);
        }
        if let Some(scene) = self.program.scenes.iter().find(|s| s.id == id) {
            return Ok(scene.stage);
        }
        // The owner's scene first, then any scene.
        let matching = |a: &Sprite| a.id == id && !a.stage;
        self.program
            .sprites
            .iter()
            .position(|a| matching(a) && a.scene == self.owner_scene)
            .or_else(|| self.program.sprites.iter().position(matching))
            .with_context(|| format!("unknown actor target {id}"))
    }
    fn chain(&mut self, mut block: Option<&Value>, warped: bool) -> Result<()> {
        enum Work<'a> {
            Chain(Option<&'a Value>, bool),
            If(&'a Value, bool, usize, Vec<usize>),
            IfBranch(&'a Value, bool, usize, Vec<usize>, usize, Expr),
            IfEnd(Vec<usize>),
            Loop(&'a Value, bool, usize),
            Range(&'a Value, bool, usize, usize),
            Tell(&'a Value, usize, Vec<Vec<usize>>),
        }
        let mut work = vec![Work::Chain(block, warped)];
        while let Some(item) = work.pop() {
            let warped = match item {
                Work::Chain(next, warped) => {
                    block = next;
                    warped
                }
                Work::If(b, warped, n, jumps) => {
                    if let Some(test) = b["inputs"].get(format!("IF{n}")) {
                        let condition = self.condition(test)?;
                        let branch = self.emit(Op::Branch(condition, 0), b);
                        work.push(Work::IfBranch(b, warped, n, jumps, branch, condition));
                        work.push(Work::Chain(b["statements"].get(format!("DO{n}")), warped));
                    } else {
                        ensure!(n > 0, "controls_if: missing input IF0");
                        work.push(Work::IfEnd(jumps));
                        work.push(Work::Chain(b["statements"].get("ELSE"), warped));
                    }
                    continue;
                }
                Work::IfBranch(b, warped, n, mut jumps, branch, condition) => {
                    jumps.push(self.emit(Op::Jump(0), b));
                    self.program.ops[branch] = Op::Branch(condition, self.program.ops.len());
                    work.push(Work::If(b, warped, n + 1, jumps));
                    continue;
                }
                Work::IfEnd(jumps) => {
                    let end = self.program.ops.len();
                    for jump in jumps {
                        self.program.ops[jump] = Op::Jump(end);
                    }
                    continue;
                }
                Work::Loop(b, warped, begin) => {
                    let kind = b["type"].as_str().unwrap();
                    if kind == "repeat_n_times" {
                        self.emit(Op::Next(begin + 1, !warped), b);
                    } else {
                        if !warped {
                            self.emit(Op::Yield, b);
                        } else if self.program.semantics == RuntimeSemantics::Kitten4 {
                            self.emit(Op::WarpIteration, b);
                        }
                        self.emit(Op::Jump(begin), b);
                    }
                    let end = self.program.ops.len();
                    if let Op::Repeat(n, _) = self.program.ops[begin] {
                        self.program.ops[begin] = Op::Repeat(n, end);
                    }
                    if kind == "repeat_forever_until" {
                        self.program.ops[begin + 1] = Op::Jump(end);
                    }
                    for pc in self.loops.pop().unwrap() {
                        self.program.ops[pc] =
                            Op::Break(end, usize::from(kind == "repeat_n_times"));
                    }
                    continue;
                }
                Work::Range(b, warped, begin, spec) => {
                    self.emit(Op::RangeNext(begin + 1, !warped), b);
                    let end = self.program.ops.len();
                    self.program.ops[begin] = Op::Range(spec, end);
                    for pc in self.loops.pop().unwrap() {
                        self.program.ops[pc] = Op::Break(end, 2);
                    }
                    self.ranges.pop();
                    continue;
                }
                Work::Tell(b, jump, loops) => {
                    self.loops = loops;
                    self.emit(Op::Halt, b);
                    self.program.ops[jump] = Op::Jump(self.program.ops.len());
                    continue;
                }
            };
            while let Some(b) = block.filter(|v| v.is_object()) {
                ensure!(
                    self.program.ops.len() < 1_000_000,
                    "program instruction limit exceeded"
                );
                let kind = b["type"].as_str().unwrap_or("");
                let op = match kind {
                    "script_variables" => {
                        for name in crate::runtime::helpers::script_variable_names(b) {
                            let local = self.local(name);
                            let zero = self.expr(
                                &serde_json::json!({"type":"math_number","fields":{"NUM":0}}),
                            )?;
                            self.emit(Op::SetLocal(local, zero), b);
                        }
                        block = b.get("next");
                        continue;
                    }
                    "variables_set" => {
                        if let Some(&slot) = self.actor_variables.get(field(b, "variable")) {
                            let value = self.value(input(b, "value")?)?;
                            self.emit(Op::SetActorVariable(slot, value), b);
                            block = b.get("next");
                            continue;
                        }
                        ensure!(
                            !self.lists.contains_key(field(b, "variable")),
                            "list assignment requires list operations at {}",
                            b["id"]
                        );
                        let target = self.target(field(b, "variable"));
                        let value = input(b, "value")?;
                        if matches!(
                            value["type"].as_str(),
                            Some(
                                "math_number"
                                    | "math_arithmetic"
                                    | "math_function"
                                    | "math_round"
                                    | "math_trig"
                                    | "math_modulo"
                                    | "timer"
                                    | "traverse_number_value"
                            )
                        ) && !(self.program.semantics == RuntimeSemantics::Kitten4
                            && value["type"] == "math_arithmetic"
                            && field(value, "type") == "add")
                            && !(self.program.semantics == RuntimeSemantics::KnCurrent
                                && value["type"] == "math_number"
                                && kn_preserved_number_text(value).is_some())
                        {
                            let expr = self.expr(value)?;
                            match target {
                                Target::Global(i) => Op::Set(i, expr),
                                Target::Local(i) => Op::SetLocal(i, expr),
                            }
                        } else {
                            Op::SetValue(target, self.value(value)?)
                        }
                    }
                    "change_variables" => {
                        if let Some(&slot) = self.actor_variables.get(field(b, "variable")) {
                            let expr = self.arg(b, "value")?;
                            let sign = if field(b, "method") == "decrease" {
                                -1.0
                            } else {
                                1.0
                            };
                            self.emit(Op::ChangeActorVariable(slot, expr, sign), b);
                            block = b.get("next");
                            continue;
                        }
                        ensure!(
                            !self.lists.contains_key(field(b, "variable")),
                            "list used as scalar at {}",
                            b["id"]
                        );
                        let target = self.target(field(b, "variable"));
                        if self.program.semantics == RuntimeSemantics::Kitten4 {
                            let value = self.value(input(b, "value")?)?;
                            self.emit(
                                Op::Kitten4Change(target, value, field(b, "method") == "decrease"),
                                b,
                            );
                            block = b.get("next");
                            continue;
                        }
                        let expr = self.arg(b, "value")?;
                        let sign = if field(b, "method") == "decrease" {
                            -1.0
                        } else {
                            1.0
                        };
                        match target {
                            Target::Global(i) => Op::Change(i, expr, sign),
                            Target::Local(i) => Op::ChangeLocal(i, expr, sign),
                        }
                    }
                    // 参考 HateNeko 0.7.1 的 rt/impl/data.lua::_variable_set。
                    "_variable_set" => Op::SetValue(
                        Target::Local(self.code_local(field(b, "VAR"))),
                        self.value(input(b, "VALUE")?)?,
                    ),
                    // 参考 HateNeko 0.7.1 的 rt/impl/js.lua::assign、math_increment/decrement。
                    "math_add_assign" | "math_sub_assign" | "math_mul_assign"
                    | "math_div_assign" | "math_mod_assign" | "math_increment"
                    | "math_decrement" => {
                        let op = match kind {
                            "math_sub_assign" | "math_decrement" => Binary::Sub,
                            "math_mul_assign" => Binary::Mul,
                            "math_div_assign" => Binary::Div,
                            "math_mod_assign" => Binary::Mod,
                            _ => Binary::Add,
                        };
                        let value = if matches!(kind, "math_increment" | "math_decrement") {
                            None
                        } else {
                            Some(self.value(input(b, "value")?)?)
                        };
                        Op::AssignLocal(self.code_local(field(b, "VAR")), value, op)
                    }
                    "kitten4_cloud_variables_set" | "kitten4_change_cloud_variable" => {
                        let change = kind == "kitten4_change_cloud_variable";
                        let id = field(b, if change { "valname" } else { "VAR" });
                        let binding = self
                            .program
                            .cloud
                            .iter()
                            .position(|v| v.id == id)
                            .unwrap_or(usize::MAX);
                        let value = self.value(input(b, if change { "n" } else { "VALUE" })?)?;
                        Op::CloudSet(binding, value, change, field(b, "method") == "decrease")
                    }
                    "kitten4_cloud_lists_append"
                    | "kitten4_cloud_lists_insert_value"
                    | "kitten4_cloud_lists_delete"
                    | "kitten4_cloud_lists_replace" => {
                        let binding = self
                            .program
                            .cloud
                            .iter()
                            .position(|v| v.id == field(b, "VAR"))
                            .unwrap_or(usize::MAX);
                        let action = match kind {
                            "kitten4_cloud_lists_append" => {
                                if field(b, "POS") == "last" {
                                    0
                                } else {
                                    1
                                }
                            }
                            "kitten4_cloud_lists_insert_value" => 2,
                            "kitten4_cloud_lists_delete" => {
                                if field(b, "TYPE") == "all" {
                                    5
                                } else {
                                    3
                                }
                            }
                            _ => 4,
                        };
                        let at = if matches!(action, 0 | 1 | 5) || field(b, "TYPE") == "last" {
                            None
                        } else {
                            Some(self.arg(b, "INDEX")?)
                        };
                        let value = if matches!(action, 3 | 5) {
                            None
                        } else {
                            Some(self.value(input(b, "VALUE")?)?)
                        };
                        Op::CloudList(binding, action, at, value)
                    }
                    "kitten4_show_ranking" => Op::Ranking(
                        self.program
                            .cloud
                            .iter()
                            .position(|v| v.id == field(b, "VAR")),
                        true,
                    ),
                    "kitten4_hide_ranking" => Op::Ranking(None, false),
                    "self_go_forward" => Op::Move(self.arg(b, "steps")?),
                    "self_move_to" => Op::Position(self.arg(b, "x")?, self.arg(b, "y")?),
                    "self_set_position_x" => Op::X(self.arg(b, "value")?),
                    "self_set_position_y" => Op::Y(self.arg(b, "value")?),
                    "self_add_position_x" => Op::AddX(self.arg(b, "value")?),
                    "self_add_position_y" => Op::AddY(self.arg(b, "value")?),
                    "self_change_coordinate_x" | "self_change_coordinate_y" => {
                        let mut e = self.arg(b, "value")?;
                        if field(b, "increase") == "decrease" || field(b, "method") == "decrease" {
                            self.program.expressions.push(ExprOp::Unary(Unary::Neg));
                            e.end += 1;
                        }
                        if kind.ends_with('x') {
                            Op::AddX(e)
                        } else {
                            Op::AddY(e)
                        }
                    }
                    "self_rotate" => Op::Turn(self.arg(b, "degrees")?),
                    "self_point_towards" => Op::Direction(self.arg(b, "degrees")?),
                    "set_scale" => Op::Scale(self.arg(b, "scale")?),
                    "self_appear" => Op::Visible(field(b, "value") == "appear"),
                    "set_sprite_style" => Op::Style(self.value(input(b, "style_id")?)?),
                    "self_prev_next_style" => {
                        ensure!(
                            matches!(field(b, "prev_next"), "next" | "prev"),
                            "unknown costume direction"
                        );
                        Op::NextStyle(field(b, "prev_next") == "next")
                    }
                    "self_set_effect" | "self_change_effect" => {
                        let scope = effect_scope(field(b, "scope")).with_context(|| {
                            format!(
                                "unsupported sprite effect {} at {}",
                                field(b, "scope"),
                                b["id"]
                            )
                        })?;
                        if kind == "self_set_effect" {
                            let value = self.arg_any(b, &["value", "val"])?;
                            if scope == 1 {
                                Op::Opacity(value)
                            } else {
                                Op::Effect(scope, value, false)
                            }
                        } else {
                            Op::Effect(scope, self.signed_arg(b, &["value", "steps"])?, true)
                        }
                    }
                    "clear_all_effects" => Op::ClearEffects,
                    "self_change_scale" => {
                        Op::ChangeScale(self.signed_arg(b, &["scale", "value"])?)
                    }
                    "set_width_height_scale" | "add_width_height_scale" => {
                        let axis = match field(b, "type") {
                            "width" => false,
                            "height" => true,
                            other => bail!("unsupported size axis {other} at {}", b["id"]),
                        };
                        let add = kind == "add_width_height_scale";
                        let value = if add {
                            self.signed_arg(b, &["value"])?
                        } else {
                            self.arg(b, "value")?
                        };
                        Op::SizeAxis(axis, value, add)
                    }
                    "self_change_pen_size" => {
                        Op::PenSizeChange(self.signed_arg(b, &["steps", "size", "value"])?)
                    }
                    "self_set_rotation_type" => Op::RotationType(match field(b, "rotation_type") {
                        "0" => 0,
                        "1" => 1,
                        "2" => 2,
                        other => bail!("unsupported rotation type {other} at {}", b["id"]),
                    }),
                    "self_face_to" | "self_face_to_sprite" => {
                        Op::FaceTo(self.point_target(field(b, "sprite"))?)
                    }
                    "self_move_specify" | "self_move_specify_sprite" => {
                        let target = b["fields"]
                            .get("target")
                            .or_else(|| b["fields"].get("sprite"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        Op::MoveToTarget(self.point_target(target)?)
                    }
                    "self_rotate_around" => Op::RotateAround(
                        self.actor_target(field(b, "sprite"))?,
                        self.arg(b, "degrees")?,
                    ),
                    "self_set_position" => {
                        let value = self.arg(b, "value")?;
                        match field(b, "coordinary") {
                            "x" => Op::X(value),
                            "y" => Op::Y(value),
                            other => bail!("unknown coordinate {other} at {}", b["id"]),
                        }
                    }
                    "self_change_coordinate" => {
                        let value = self.signed_arg(b, &["value"])?;
                        match field(b, "coordinary") {
                            "x" => Op::AddX(value),
                            "y" => Op::AddY(value),
                            other => bail!("unknown coordinate {other} at {}", b["id"]),
                        }
                    }
                    "self_glide_to"
                    | "self_glide_coordinate"
                    | "self_glide_coordinate_x"
                    | "self_glide_coordinate_y" => {
                        let time = self.arg(b, "time")?;
                        let spec = if kind == "self_glide_to" {
                            GlideSpec {
                                time,
                                x: Some(self.arg(b, "x")?),
                                y: Some(self.arg(b, "y")?),
                                relative: false,
                            }
                        } else {
                            let axis = match kind {
                                "self_glide_coordinate_x" => "x",
                                "self_glide_coordinate_y" => "y",
                                _ => field(b, "coordinary"),
                            };
                            let value = self.signed_arg(b, &["value"])?;
                            match axis {
                                "x" => GlideSpec {
                                    time,
                                    x: Some(value),
                                    y: None,
                                    relative: true,
                                },
                                "y" => GlideSpec {
                                    time,
                                    x: None,
                                    y: Some(value),
                                    relative: true,
                                },
                                other => bail!("unknown coordinate {other} at {}", b["id"]),
                            }
                        };
                        self.program.glides.push(spec);
                        self.emit(Op::Glide(self.program.glides.len() - 1), b);
                        Op::AnimStep
                    }
                    "self_gradually_show_hide" => {
                        let state = b["fields"]
                            .get("is_show")
                            .or_else(|| b["fields"].get("show_hide"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let show = match state {
                            "show" | "appear" => true,
                            "hide" | "disappear" => false,
                            other => bail!("unknown fade state {other} at {}", b["id"]),
                        };
                        let time = self.arg(b, "time")?;
                        self.emit(Op::Fade(time, show), b);
                        Op::AnimStep
                    }
                    "restart" => Op::Restart,
                    "mirror" => Op::Clone(self.actor_target(field(b, "sprite"))?),
                    "kitten4_split" => Op::Split(
                        self.actor_target(field(b, "sprite"))?,
                        self.arg(b, "x")?,
                        self.arg(b, "y")?,
                    ),
                    "switch_to_screen" => {
                        let target = b["inputs"]
                            .get("screen_id")
                            .or_else(|| b["inputs"].get("screen"))
                            .with_context(|| {
                                format!("switch_to_screen: missing scene at {}", b["id"])
                            })?;
                        Op::SwitchScene(self.value(target)?)
                    }
                    "set_screen_transition" | "set_scene_transition" => {
                        let direction = field(b, "direction");
                        let kind = b["fields"]
                            .get("type")
                            .or_else(|| b["fields"].get("transition"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        ensure!(
                            matches!(direction, "up" | "down" | "left" | "right" | ""),
                            "unknown transition direction {direction} at {}",
                            b["id"]
                        );
                        Op::SceneTransition(
                            self.push_constant(Cell::Text(direction.into())),
                            self.push_constant(Cell::Text(kind.into())),
                        )
                    }
                    "self_dialog" | "self_dialog_wait" | "create_stage_dialog" => {
                        let think = match field(b, "type") {
                            "think" => true,
                            "" | "say" | "talk" => false,
                            other => bail!("unknown dialog type {other} at {}", b["id"]),
                        };
                        let text = self.value(input(b, "text")?)?;
                        let timed = kind == "self_dialog" && b["inputs"].get("time").is_some();
                        if timed {
                            // Say for N seconds: show, wait, close.
                            self.emit(Op::Dialog(text, think), b);
                            let time = self.arg(b, "time")?;
                            self.emit(Op::Wait(time), b);
                            Op::CloseDialog
                        } else {
                            Op::Dialog(text, think)
                        }
                    }
                    "close_self_dialog" => Op::CloseDialog,
                    "self_bounce_off_edge" => Op::Bounce,
                    "self_set_role_camp" => {
                        Op::Camp(camp_code(field(b, "role_camp")).with_context(|| {
                            format!("unknown camp {} at {}", field(b, "role_camp"), b["id"])
                        })?)
                    }
                    "self_stress_animation" => {
                        self.emit(
                            Op::Emphasis(match field(b, "animation") {
                                "shake" => 0,
                                "scale" => 1,
                                "bounce" => 2,
                                other => bail!("unknown emphasis animation {other} at {}", b["id"]),
                            }),
                            b,
                        );
                        Op::TimelineStep
                    }
                    "self_appear_animation" => {
                        let appear = match field(b, "appear") {
                            "appear" => true,
                            "disappear" => false,
                            other => bail!("unknown appear mode {other} at {}", b["id"]),
                        };
                        let kind = match field(b, "animation") {
                            "slideIn" => 0,
                            "bounceIn" => 1,
                            "flyIn" => 2,
                            "slideOut" => 3,
                            "bounceOut" => 4,
                            "flyOut" => 5,
                            other => bail!("unknown transition animation {other} at {}", b["id"]),
                        };
                        let direction = match field(b, "direction") {
                            "up" => 0,
                            "down" => 1,
                            "left" => 2,
                            "right" => 3,
                            other => bail!("unknown animation direction {other} at {}", b["id"]),
                        };
                        self.emit(Op::Transition(appear, kind, direction), b);
                        Op::TimelineStep
                    }
                    "self_text_effect_text" => Op::SpriteText(self.value(input(b, "text")?)?),
                    "self_text_effect_size" => Op::TextSize(self.arg(b, "size")?),
                    "self_text_effect_color" => {
                        let color = field(b, "color").trim_start_matches('#');
                        Op::TextColor(u32::from_str_radix(color, 16).with_context(|| {
                            format!("invalid text colour {} at {}", field(b, "color"), b["id"])
                        })?)
                    }
                    "self_set_draggable" => {
                        Op::Draggable(matches!(field(b, "draggable"), "1" | "true" | "draggable"))
                    }
                    "image_stamp" => Op::ImageStamp,
                    "play_audio_and_wait" => {
                        let audio = b["inputs"]
                            .get("audio_id")
                            .map(|v| self.value(v))
                            .unwrap_or_else(|| {
                                Ok(self.push_constant(Cell::Text(field(b, "audio").into())))
                            })?;
                        Op::AudioWait(audio)
                    }
                    "show_hide_variables" | "show_hide_list" => {
                        let list = kind == "show_hide_list";
                        let id = field(b, if list { "list" } else { "variable" });
                        if let Some(&slot) = self.actor_variables.get(id) {
                            let owner = self
                                .program
                                .sprites
                                .iter()
                                .position(|s| s.variables.contains_key(&slot))
                                .with_context(|| format!("private monitor {id}: missing owner"))?;
                            let monitor = self
                                .program
                                .monitor_targets
                                .iter()
                                .position(|(existing, _, _)| existing == id)
                                .unwrap_or_else(|| {
                                    let monitor = self.program.monitor_targets.len();
                                    self.program
                                        .monitor_targets
                                        .push((id.to_owned(), list, slot));
                                    self.program.actor_monitors.insert(monitor, (owner, slot));
                                    monitor
                                });
                            self.emit(Op::Monitor(monitor, field(b, "show_hide") != "hide"), b);
                            block = b.get("next");
                            continue;
                        }
                        let target = if list {
                            *self
                                .lists
                                .get(id)
                                .with_context(|| format!("unknown list {id}"))?
                        } else {
                            match self.target(id) {
                                Target::Global(slot) => slot,
                                Target::Local(_) => {
                                    bail!("script variables have no monitor at {}", b["id"])
                                }
                            }
                        };
                        let monitor = self
                            .program
                            .monitor_targets
                            .iter()
                            .position(|(existing, is_list, _)| existing == id && *is_list == list)
                            .unwrap_or_else(|| {
                                let monitor = self.program.monitor_targets.len();
                                self.program
                                    .monitor_targets
                                    .push((id.to_owned(), list, target));
                                monitor
                            });
                        Op::Monitor(monitor, field(b, "show_hide") != "hide")
                    }
                    "self_ask" => Op::Ask(self.value(input(b, "text")?)?, None),
                    "ask_and_choose" => {
                        let question = self.value(input(b, "question")?)?;
                        let mut choices = vec![];
                        while let Some(choice) = b["inputs"].get(format!("CHOICE{}", choices.len()))
                        {
                            choices.push(self.value(choice)?);
                        }
                        let span = Span {
                            start: self.program.value_args.len() as u32,
                            len: choices.len() as u32,
                        };
                        self.program.value_args.extend(choices);
                        Op::Ask(question, Some(span))
                    }
                    "kitten4_noop" => {
                        block = b.get("next");
                        continue;
                    }
                    "kitten4_set_velocity" => Op::PhysicsVelocity(
                        self.value(input(b, "value")?)?,
                        self.value(input(b, "dir")?)?,
                    ),
                    kind if kind.starts_with("kitten4_legacy_") => {
                        let command = physics::Command::parse_legacy(kind, b)?;
                        let zero = serde_json::json!({"type":"math_number","fields":{"NUM":0}});
                        let value = self.value(
                            ["friction", "restitution", "mass", "density"]
                                .iter()
                                .find_map(|key| b["inputs"].get(*key))
                                .unwrap_or(&zero),
                        )?;
                        Op::LegacyPhysics(command, value)
                    }
                    kind if kind.starts_with("physics2_") => {
                        let command = physics::Command::parse(kind, b, |id| self.actor_target(id))?;
                        let zero = serde_json::json!({"type":"math_number","fields":{"NUM":0}});
                        let a = self.expr(
                            ["value", "mass", "friction", "restitution"]
                                .iter()
                                .find_map(|key| b["inputs"].get(*key))
                                .unwrap_or(&zero),
                        )?;
                        let dir = self.expr(b["inputs"].get("dir").unwrap_or(&zero))?;
                        let time = self.expr(b["inputs"].get("time").unwrap_or(&zero))?;
                        Op::Physics(command, a, dir, time)
                    }
                    "dispose_clone" => Op::DisposeClone,
                    "kitten4_dispose" => Op::DisposeSelf,
                    "set_top_bottom_layer" | "self_change_layer" => {
                        let layer = field(b, "layer");
                        let relative = field(b, "target_layer");
                        Op::Layer(if relative.is_empty() {
                            match layer {
                                "peak" | "top" | "front" => LayerMove::Front,
                                "bottom" | "back" => LayerMove::Back,
                                "prev_layer" | "forward" | "up" => LayerMove::Forward,
                                "next_layer" | "backward" | "down" => LayerMove::Backward,
                                "n" if self.program.semantics == RuntimeSemantics::Kitten4 => {
                                    LayerMove::By(self.arg(b, "n")?)
                                }
                                _ => bail!("unknown layer {layer} at {}", b["id"]),
                            }
                        } else {
                            ensure!(
                                matches!(relative, "prev_layer" | "next_layer"),
                                "unknown relative layer {relative} at {}",
                                b["id"]
                            );
                            let target = self.actor_target(layer)?;
                            ensure!(
                                target != usize::MAX && !self.program.sprites[target].stage,
                                "relative layer needs another actor at {}",
                                b["id"]
                            );
                            LayerMove::Relative(target, relative == "prev_layer")
                        })
                    }
                    "procedures_2_return_value"
                        if self.program.semantics == RuntimeSemantics::KnCurrent
                            && b["inputs"].get("VALUE").is_none()
                            && crate::runtime::helpers::attr_value(
                                b["mutation"].as_str().unwrap_or(""),
                                "type",
                            ) == Some("NORMAL") =>
                    {
                        // KN's NORMAL form exits the current procedure; it has no
                        // VALUE socket. ROUND/malformed missing values stay errors.
                        Op::Return
                    }
                    "procedures_2_return_value" => Op::ReturnValue(self.value(input(b, "VALUE")?)?),
                    "when" => {
                        // Statement form: wait until the condition holds, run DO, continue.
                        let condition = self.condition(input(b, "condition")?)?;
                        self.emit(Op::WaitUntil(condition), b);
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::Chain(b["statements"].get("DO"), warped));
                        block = None;
                        continue;
                    }
                    "tell" | "sync_tell" => {
                        let target = self.actor_target(field(b, "sprite"))?;
                        let tell = self.emit(Op::Tell(target, 0, kind == "sync_tell"), b);
                        let jump = self.emit(Op::Jump(0), b);
                        // The body is a separate task: loop breaks never cross into it.
                        let loops = std::mem::take(&mut self.loops);
                        self.program.ops[tell] = Op::Tell(target, jump + 1, kind == "sync_tell");
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::Tell(b, jump, loops));
                        work.push(Work::Chain(b["statements"].get("DO"), false));
                        block = None;
                        continue;
                    }
                    "set_pen_layer" => {
                        let layer = field(b, "layer");
                        let relative = field(b, "target_layer");
                        Op::PenLayer(if relative.is_empty() {
                            match layer {
                                "peak" => PenLayer::Top,
                                "bottom" => PenLayer::Bottom,
                                "prev_layer" => PenLayer::Forward,
                                "next_layer" => PenLayer::Backward,
                                _ => bail!("unknown pen layer {layer} at {}", b["id"]),
                            }
                        } else {
                            ensure!(
                                matches!(relative, "prev_layer" | "next_layer"),
                                "unknown relative pen layer {relative}"
                            );
                            let index = self
                                .actor_ids
                                .iter()
                                .position(|id| id == layer)
                                .context("unknown pen layer target")?;
                            PenLayer::Relative(
                                self.actor_ids.len() - 1 - index,
                                relative == "prev_layer",
                            )
                        })
                    }
                    "self_pen_down" => Op::Pen(true),
                    "self_pen_up" => Op::Pen(false),
                    "pen_begin_path" => Op::PenPath(true),
                    "pen_close_path" => Op::PenPath(false),
                    "clear_drawing" => Op::Clear,
                    "play_audio" | "stop_audio" => {
                        let audio = input(b, "audio_id")
                            .with_context(|| format!("audio input at {}", b["id"]))?;
                        Op::Audio(self.value(audio)?, kind == "play_audio")
                    }
                    "delete_list_item" => {
                        let list = self.list(input(b, "list")?)?;
                        match field(b, "item") {
                            "all" => Op::ClearList(list),
                            "last" => Op::DeleteList(list, None),
                            "any" => Op::DeleteList(list, Some(self.arg(b, "list_index")?)),
                            other => bail!("unsupported list selector {other}"),
                        }
                    }
                    "list_append" => Op::AppendList(
                        self.list(input(b, "list")?)?,
                        self.value(input(b, "list_item_value")?)?,
                    ),
                    "list_insert_value" => Op::InsertList(
                        self.list(input(b, "list")?)?,
                        self.arg(b, "list_index")?,
                        self.value(input(b, "list_item_value")?)?,
                    ),
                    "replace_list_item" => Op::ReplaceList(
                        self.list(input(b, "list")?)?,
                        if field(b, "item") == "last" {
                            None
                        } else {
                            Some(self.arg(b, "list_index")?)
                        },
                        self.value(input(b, "list_item_value")?)?,
                    ),
                    "list_copy" => Op::CopyList(
                        self.list(input(b, "list")?)?,
                        self.list(input(b, "target_list")?)?,
                    ),
                    "show_hide_timer" => Op::TimerVisible(field(b, "showHide") == "show"),
                    "set_timer_state" => Op::Timer(match field(b, "type") {
                        "start" => TimerState::Start,
                        "stop" => TimerState::Stop,
                        "reset" => TimerState::Reset,
                        other => bail!("unknown timer state {other}"),
                    }),
                    "self_set_pen_color_property" | "self_change_pen_color_property" => {
                        let property = match field(b, "scope") {
                            "hue" => PenProperty::Hue,
                            "saturation" => PenProperty::Saturation,
                            "brightness" => PenProperty::Brightness,
                            "alpha" => PenProperty::Alpha,
                            other => bail!("unsupported pen property {other}"),
                        };
                        let change = kind == "self_change_pen_color_property";
                        Op::PenProperty(
                            property,
                            self.arg(b, if change { "steps" } else { "val" })?,
                            if !change {
                                0
                            } else if field(b, "increase") == "decrease" {
                                -1
                            } else {
                                1
                            },
                        )
                    }
                    "stamp" => Op::Stamp(
                        self.text(input(b, "text")?)?,
                        self.arg(b, "size")?,
                        match field(b, "align") {
                            "left" => TextAlign::Left,
                            "center" => TextAlign::Center,
                            "right" => TextAlign::Right,
                            other => bail!("unsupported stamp alignment {other}"),
                        },
                    ),
                    "self_set_pen_size" => Op::Size(self.arg(b, "size")?),
                    "self_set_pen_color" | "set_fill_style" => {
                        let color = field(b, "color").trim_start_matches('#');
                        ensure!(color.len() == 6, "expected RGB hex color");
                        let n = u32::from_str_radix(color, 16)?;
                        let color = [
                            ((n >> 16) & 255) as f32 / 255.0,
                            ((n >> 8) & 255) as f32 / 255.0,
                            (n & 255) as f32 / 255.0,
                            1.0,
                        ];
                        if kind == "set_fill_style" {
                            Op::FillColor(color)
                        } else {
                            Op::Color(color)
                        }
                    }
                    "wait" => Op::Wait(self.arg(b, "time")?),
                    "wait_until" => Op::WaitUntil(self.condition(input(b, "condition")?)?),
                    "self_broadcast" | "self_broadcast_with_param" | "self_broadcast_and_wait" => {
                        Op::Broadcast(
                            self.value(input(b, "message")?)?,
                            if kind == "self_broadcast_with_param" {
                                Some(self.value(input(b, "param")?)?)
                            } else {
                                None
                            },
                            kind == "self_broadcast_and_wait",
                        )
                    }
                    "stop" => Op::Stop(match field(b, "scope") {
                        "0" => 0,
                        "" | "1" => 1,
                        "2" => 2,
                        "3" => 3,
                        other => bail!("unknown stop scope {other}"),
                    }),
                    "self_flip" => Op::Flip(match field(b, "options") {
                        "0" => false,
                        "1" => true,
                        other => bail!("unknown flip axis {other}"),
                    }),
                    "set_volume_or_rate_2" | "change_volume_or_rate_2" => {
                        let rate = match field(b, "audio_key") {
                            "volume" => false,
                            "rate" => true,
                            other => bail!("unknown audio property {other}"),
                        };
                        Op::AudioProperty(
                            self.value(input(b, "audio")?)?,
                            self.value(input(b, "audio_value")?)?,
                            rate,
                            kind == "change_volume_or_rate_2",
                            field(b, "increase") == "decrease",
                        )
                    }
                    "procedures_2_callnoreturn" => {
                        let (base, index) = self.call_arguments(b)?;
                        Op::Call(base + usize::from(warped), index)
                    }
                    "console_log" => {
                        let val = input(b, "console_log")?;
                        if !matches!(
                            val["type"].as_str(),
                            Some(
                                "math_number"
                                    | "math_arithmetic"
                                    | "math_round"
                                    | "timer"
                                    | "traverse_number_value"
                                    | "text"
                            )
                        ) {
                            Op::LogText(self.text(val)?)
                        } else if val["type"] == "text" {
                            let index = self.program.strings.len();
                            self.program.strings.push(field(val, "TEXT").into());
                            Op::Log(index)
                        } else {
                            Op::LogNumber(self.expr(val)?)
                        }
                    }
                    "warp" => {
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::Chain(
                            b.get("statements").and_then(|s| s.get("DO")),
                            true,
                        ));
                        block = None;
                        continue;
                    }
                    "controls_if" => {
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::If(b, warped, 0, vec![]));
                        block = None;
                        continue;
                    }
                    "repeat_n_times" | "repeat_forever" | "repeat_forever_until" => {
                        let begin = self.program.ops.len();
                        if kind == "repeat_n_times" {
                            let n = self.arg(b, "times")?;
                            self.emit(Op::Repeat(n, 0), b);
                        } else if kind == "repeat_forever_until" {
                            let c = self.condition(input(b, "condition")?)?;
                            let gate = self.emit(Op::Branch(c, begin + 2), b);
                            debug_assert_eq!(gate, begin);
                            self.emit(Op::Jump(0), b);
                        }
                        self.loops.push(vec![]);
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::Loop(b, warped, begin));
                        work.push(Work::Chain(b["statements"].get("DO"), warped));
                        block = None;
                        continue;
                    }
                    "traverse_number" => {
                        let param = input(b, "value")?;
                        ensure!(
                            param["type"] == "traverse_number_param",
                            "range missing parameter at {}",
                            b["id"]
                        );
                        let from = self.arg(b, "from")?;
                        let to = self.arg(b, "to")?;
                        let by = if self.program.semantics == RuntimeSemantics::KnCurrent
                            && b["inputs"].get("by").is_none()
                        {
                            self.expr(
                                &serde_json::json!({"type":"math_number","fields":{"NUM":1}}),
                            )?
                        } else {
                            self.arg(b, "by")?
                        };
                        let spec = self.program.ranges.len();
                        self.program.ranges.push(RangeSpec { from, to, by });
                        let begin = self.emit(Op::Range(spec, 0), b);
                        self.ranges.push(field(param, "TEXT").into());
                        self.loops.push(vec![]);
                        work.push(Work::Chain(b.get("next"), warped));
                        work.push(Work::Range(b, warped, begin, spec));
                        work.push(Work::Chain(b["statements"].get("DO"), warped));
                        block = None;
                        continue;
                    }
                    "break" => {
                        ensure!(!self.loops.is_empty(), "break outside loop");
                        let pc = self.emit(Op::Break(0, 0), b);
                        self.loops.last_mut().unwrap().push(pc);
                        block = b.get("next");
                        continue;
                    }
                    _ => bail!("unsupported fast-VM block {kind} ({})", b["id"]),
                };
                self.emit(op, b);
                block = b.get("next");
            }
        }
        Ok(())
    }
}

fn json_proxy(index: usize) -> Value {
    serde_json::json!({"type":"_compiled_value", "index":index})
}

#[derive(Clone)]
struct Task {
    id: u64,
    created: u64,
    wait_started: Option<u64>,
    wait_finished: bool,
    pc: usize,
    actor: usize,
    loops: Vec<u64>,
    ranges: Vec<RangeState>,
    calls: Vec<CallFrame>,
    parameters: Vec<Cell>,
    payload: Cell,
    waiter: Option<u64>,
    pending: usize,
    wake: f64,
    done: bool,
    locals: Vec<f64>,
    local_values: Vec<Option<Cell>>,
    anim: Option<Anim>,
    returned: Option<Cell>,
    /// The actor met by a collision script (usize::MAX when none).
    bumped: usize,
    timeline: Option<Box<Timeline>>,
    /// Script index when spawned by an event dispatch (usize::MAX otherwise).
    script: usize,
    /// A source-backed K4 global Start root keeps executing across scene changes.
    /// Child tasks default to scene-bound; this is not a general stop immunity.
    global_start: bool,
    /// KN when only: survives scene exit but cannot execute off-scene. Unlike
    /// K4 global Start this is suspension, not cross-scene execution immunity.
    kn_when: bool,
}
impl Task {
    fn new(id: u64, script: &Script, program: &Program) -> Self {
        Self {
            id,
            created: 0,
            wait_started: None,
            wait_finished: false,
            pc: script.start,
            actor: script.actor,
            loops: vec![],
            ranges: vec![],
            calls: vec![],
            parameters: vec![],
            payload: Cell::Number(f64::NAN),
            waiter: None,
            pending: 0,
            wake: 0.0,
            done: false,
            locals: (0..program.local_count)
                .map(|i| {
                    if program.code_locals.contains(&i) {
                        f64::NAN
                    } else {
                        0.0
                    }
                })
                .collect(),
            local_values: vec![None; program.local_count],
            anim: None,
            returned: None,
            bumped: usize::MAX,
            timeline: None,
            script: usize::MAX,
            global_start: false,
            kn_when: false,
        }
    }
}

/// Animated sprite properties: x, y, width %, height %, direction, opacity.
const TL_X: usize = 0;
const TL_Y: usize = 1;
const TL_SX: usize = 2;
const TL_SY: usize = 3;
const TL_DIR: usize = 4;
const TL_ALPHA: usize = 5;
type Props = [f64; 6];
const NO_PROPS: Props = [f64::NAN; 6];
/// One tween of an official stage animation timeline (stage_animation chunk).
#[derive(Clone, Debug)]
struct Tween {
    /// Seconds from the timeline start.
    at: f64,
    duration: f64,
    /// FROM_TO start values applied when the tween begins (NaN: untouched).
    from: Props,
    to: Props,
    /// Values when the tween began; NaN until it has started.
    begin: Props,
}
#[derive(Clone, Debug)]
struct Timeline {
    start: f64,
    tweens: Vec<Tween>,
    /// Appear/disappear restore the state from before the animation.
    restore: Option<Props>,
    hide: bool,
}
impl Timeline {
    /// Builds the sequence; `label` places a tween at the start of an earlier one
    /// (the official `timeline_pos: "pN"`), otherwise it follows the timeline end.
    fn new(start: f64, specs: &[(f64, Props, Props, Option<usize>)]) -> Self {
        let mut tweens: Vec<Tween> = Vec::with_capacity(specs.len());
        let mut end: f64 = 0.0;
        for &(duration, from, to, label) in specs {
            let at = match label {
                Some(i) if i < tweens.len() => tweens[i].at,
                _ => end,
            };
            end = end.max(at + duration);
            tweens.push(Tween {
                at,
                duration,
                from,
                to,
                begin: NO_PROPS,
            });
        }
        Self {
            start,
            tweens,
            restore: None,
            hide: false,
        }
    }
    fn total(&self) -> f64 {
        self.tweens
            .iter()
            .map(|t| t.at + t.duration)
            .fold(0.0, f64::max)
    }
}
fn props_of(a: &Sprite) -> Props {
    [a.x, a.y, a.size_x, a.size_y, a.direction, a.opacity]
}
fn set_prop(a: &mut Sprite, i: usize, v: f64) {
    match i {
        TL_X => a.x = v,
        TL_Y => a.y = v,
        TL_SX => a.size_x = v,
        TL_SY => a.size_y = v,
        TL_DIR => a.direction = v,
        _ => a.opacity = v.clamp(0.0, 1.0),
    }
}
/// Symmetric cubic ease standing in for the official per-tween bezier curves.
fn ease(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}
fn props(pairs: &[(usize, f64)]) -> Props {
    let mut p = NO_PROPS;
    for &(i, v) in pairs {
        p[i] = v;
    }
    p
}
#[derive(Clone)]
struct CallFrame {
    pc: usize,
    parameters: Vec<Cell>,
    /// Loop/range stack depths at the call, restored by an early return.
    loops: usize,
    ranges: usize,
}
#[derive(Clone)]
struct RangeState {
    value: f64,
    end: f64,
    step: f64,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}
#[derive(Clone, Debug, Serialize)]
pub struct TextStamp {
    /// Draw after this many packed line instances in the same frame.
    pub before_line: usize,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub direction: f64,
    pub align: TextAlign,
    pub color: [f32; 4],
}
/// Additive JSON header extension; packed line instances and frame envelope stay unchanged.
#[derive(Clone, Debug, Serialize)]
pub struct PenFill {
    pub before_line: usize,
    /// Per-kind cursors preserve ties even when text/image stamps interleave.
    pub before_text: usize,
    pub before_image: usize,
    pub points: Vec<[f64; 2]>,
    pub color: [f32; 4],
}
#[derive(Clone, Debug, Serialize)]
pub struct AudioCommand {
    pub audio: Cell,
    pub play: bool,
    /// Report `audio_done` with this id when playback ends.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property: Option<AudioProperty>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AudioProperty {
    pub rate: bool,
    pub change: bool,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    pub sequence: u64,
    pub reset: bool,
    pub sprites: Vec<Sprite>,
    pub variables: Vec<f64>,
    pub timer: f64,
    pub timer_visible: bool,
    /// Number of actors below the shared pen surface, in back-to-front order.
    pub pen_layer: usize,
    pub logs: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub audio_commands: Vec<AudioCommand>,
    /// Sprite ids back to front, sent when layers change or clones appear.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Vec<String>>,
    /// Deleted clone ids.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub removed: Vec<String>,
    /// Active scene id. When it changes the viewer swaps pen surface and sprites.
    pub scene: String,
    /// Set on the frame that switched scenes, if a transition was configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<Transition>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub scene_changed: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub image_stamps: Vec<ImageStamp>,
    /// Visible variable/list monitors with current values.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub monitors: Vec<Monitor>,
    /// The question waiting for an answer (repeated every frame until answered).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ask: Option<AskRequest>,
    /// Packed capsule instances: x1,y1,x2,y2,width,r,g,b,a. Only NEW strokes.
    #[serde(skip)]
    pub lines: Vec<f32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub text_stamps: Vec<TextStamp>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pen_fills: Vec<PenFill>,
    pub clear: bool,
    pub active: usize,
    pub instructions: usize,
    /// Scheduler ticks run for this frame (more than 1 only when coalescing).
    pub ticks: usize,
    pub execute_us: u128,
    pub budget_yield: bool,
}
pub struct Engine {
    trace_filter: Option<BTreeSet<String>>,
    trace_truncated: bool,
    warp_iterations: u32,
    cloud: cloud::State,
    scheduler_tick: u64,
    oracle_events: Option<Vec<Value>>,
    evaluation_cache: Vec<BTreeMap<(bool, usize), VecDeque<Cell>>>,
    physics: Option<Box<physics::Physics>>,
    pub program: Program,
    jit: Option<Box<jit::Jit>>,
    jit_error: Option<anyhow::Error>,
    /// Last on_bump_actor contact per (script, instance).
    bump_state: std::collections::HashMap<(usize, usize), Option<usize>>,
    has_bump_scripts: bool,
    /// Per-scene RGBA pen raster at stage resolution (only when `uses_color`).
    pen_rasters: Vec<Option<Vec<u8>>>,
    slots: Vec<f64>,
    lists: Vec<List>,
    values: Vec<Option<Cell>>,
    pressed: std::collections::BTreeSet<String>,
    released: BTreeSet<String>,
    mouse: [f64; 2],
    pen_layer: usize,
    random_state: u64,
    sprites: Vec<Sprite>,
    tasks: Vec<Task>,
    next_task_id: u64,
    received: BTreeSet<String>,
    lines: Vec<f32>,
    text_stamps: Vec<TextStamp>,
    pen_fills: Vec<PenFill>,
    logs: Vec<String>,
    audio_commands: Vec<AudioCommand>,
    clear: bool,
    time: f64,
    timer: f64,
    timer_running: bool,
    timer_visible: bool,
    current_task: usize,
    sequence: u64,
    cursor: usize,
    /// Tasks runnable in the current tick (broadcast receivers and released waiters
    /// are appended while it runs).
    ready: VecDeque<usize>,
    dirty: Vec<bool>,
    reset: bool,
    value_error: Option<String>,
    stopped: bool,
    restart: bool,
    reporter_depth: usize,
    /// Drawable sprites of the active scene, back to front (stage excluded).
    order: Vec<usize>,
    current_scene: usize,
    /// Saved draw order of every scene (the active one lives in `order`).
    scene_orders: Vec<Vec<usize>>,
    scene_changed: bool,
    next_transition: Option<Transition>,
    transition: Option<Transition>,
    order_dirty: bool,
    removed: Vec<String>,
    free_slots: Vec<usize>,
    clone_serial: u64,
    clones: usize,
    /// Per-frame creation counts and monotonic clone numbers (not variable storage).
    clone_counts: BTreeMap<usize, u32>,
    clone_orders: BTreeMap<usize, u32>,
    asks: VecDeque<AskRequest>,
    next_ask: u64,
    image_stamps: Vec<ImageStamp>,
    monitors: Vec<bool>,
    /// Audio waits: (task id, wait id) resumed by `audio_finished`.
    audio_waits: Vec<(u64, u64)>,
    next_audio_wait: u64,
    answer: Cell,
    choice: (f64, Cell),
    /// Viewer's UTC offset in minutes (local time reporters).
    tz_offset_min: f64,
    pointer_down: bool,
    pointer_clicked: bool,
    pointer_released: bool,
}
impl Engine {
    /// Opt-in instruction tracing. Disable native batching so source boundaries
    /// remain visible; normal execution pays no snapshot/allocation cost.
    pub fn trace_blocks(&mut self) {
        self.disable_jit();
        self.oracle_events = Some(Vec::new());
    }
    pub fn take_oracle_events(&mut self) -> Vec<Value> {
        self.oracle_events
            .as_mut()
            .map(std::mem::take)
            .unwrap_or_default()
    }
    pub fn trace_block_filter(&mut self, blocks: impl IntoIterator<Item = String>) {
        self.trace_filter = Some(blocks.into_iter().collect());
    }
    pub fn oracle_trace_truncated(&self) -> bool {
        self.trace_truncated
    }
    fn trace_task(&mut self, event: &str, index: usize, block: Option<usize>) {
        if self.oracle_events.is_none() {
            return;
        }
        if matches!(event, "block" | "list")
            && self.trace_filter.as_ref().is_some_and(|filter| {
                block.is_none_or(|pc| !filter.contains(&self.program.sources[pc]))
            })
        {
            return;
        }
        if self
            .oracle_events
            .as_ref()
            .is_some_and(|events| events.len() >= 500_000)
        {
            self.trace_truncated = true;
            return;
        }
        let task = &self.tasks[index];
        let hat = self
            .program
            .scripts
            .get(task.script)
            .map(|s| s.hat.as_str());
        let entry = serde_json::json!({"frame":self.sequence.max(1), "event":event,
            "entity":self.sprites[task.actor].id, "hat":hat,
            "block":block.map(|pc| &self.program.sources[pc]), "pc":task.pc});
        self.oracle_events.as_mut().unwrap().push(entry);
    }
    fn trace_list_lengths(&self) -> Option<Vec<usize>> {
        self.oracle_events
            .as_ref()
            .map(|_| self.lists.iter().map(|list| list.borrow().len()).collect())
    }
    fn trace_list_changes(&mut self, index: usize, pc: usize, lengths: Option<Vec<usize>>) {
        if let Some(lengths) = lengths {
            for (list, before) in lengths.into_iter().enumerate() {
                let after = self.lists[list].borrow().len();
                if before != after && !self.trace_truncated {
                    if self
                        .trace_filter
                        .as_ref()
                        .is_some_and(|filter| !filter.contains(&self.program.sources[pc]))
                    {
                        continue;
                    }
                    self.trace_task("list", index, Some(pc));
                    if self.trace_truncated {
                        break;
                    }
                    let entry = self.oracle_events.as_mut().unwrap().last_mut().unwrap();
                    entry["list"] = serde_json::json!(self.program.list_names[list]);
                    entry["before"] = serde_json::json!(before);
                    entry["length"] = serde_json::json!(after);
                }
            }
        }
    }
    /// Full, non-consuming state for local differential oracles. Unlike `Frame`,
    /// this includes unchanged sprites and typed scalar/list values on every tick.
    /// Rotation is expressed in native K4 degrees, scale in percentages.
    pub fn oracle_snapshot(&self, frame: u32) -> Value {
        let actors: BTreeMap<_, _> = self
            .sprites
            .iter()
            .filter(|a| a.alive && !a.stage)
            .map(|a| {
                (
                    a.id.clone(),
                    serde_json::json!({"id": a.id,
                        "prototype_id": self.sprites[a.origin].id, "name": a.name,
                        "x": a.x, "y": a.y, "rotation": 90.0 - a.direction,
                        "current_style_id": a.style, "scale": a.scale * a.size_x / 100.0,
                        "scale_y": a.scale * a.size_y / 100.0, "visible": a.visible}),
                )
            })
            .collect();
        let mut variables = BTreeMap::new();
        for (i, id) in self.program.variable_names.iter().enumerate() {
            variables.insert(id.clone(), serde_json::json!(self.global_value(i)));
        }
        for (i, id) in self.program.list_names.iter().enumerate() {
            variables.insert(id.clone(), serde_json::json!(self.list_values(i)));
        }
        serde_json::json!({"frame": frame, "current_scene_id": self.program.scenes[self.current_scene].id,
            "actors": actors, "variables": variables, "entity_variables": {}})
    }

    pub fn active_tasks(&self) -> usize {
        self.tasks.iter().filter(|t| self.task_active(t)).count()
    }
    /// Scene-bound K4 tasks and KN when tasks suspend outside their scene.
    /// K4 global Start remains runnable regardless of its owner's scene.
    fn task_active(&self, task: &Task) -> bool {
        !task.done
            && (!(task.kn_when
                || (self.program.semantics == RuntimeSemantics::Kitten4 && !task.global_start))
                || (self.sprites[task.actor].alive
                    && self.sprites[task.actor].scene == self.current_scene))
    }
    fn task_runnable(&self, task: &Task) -> bool {
        self.task_active(task)
            && task.pending == 0
            && task.wake <= self.time
            && task.wait_started.is_none()
    }
    pub fn numeric_variables(&self) -> &[f64] {
        &self.slots
    }
    /// Complete, detached observation; unlike a frame this never ticks the VM,
    /// drains deltas, clears dirty flags, or changes the scheduler.
    pub fn debug_snapshot(&self) -> serde_json::Value {
        let actors: BTreeMap<_, _> = self
            .sprites
            .iter()
            .filter(|sprite| sprite.alive && !sprite.stage)
            .map(|sprite| {
                (
                    sprite.id.clone(),
                    serde_json::json!({
                        "x":sprite.x, "y":sprite.y,
                        // Raw VM heading, clockwise from up (not the draw angle).
                        "direction":sprite.direction,
                        "visible":sprite.visible, "scale":sprite.scale,
                        "size_x":sprite.size_x, "size_y":sprite.size_y,
                        "costume":sprite.style,
                        "variables":sprite.variables.iter().map(|(&slot, value)|
                            (self.program.actor_variable_names[slot].clone(), value.clone()))
                            .collect::<BTreeMap<_, _>>(),
                    }),
                )
            })
            .collect();
        let variables: BTreeMap<_, _> = self
            .program
            .variable_names
            .iter()
            .enumerate()
            .map(|(index, id)| (id.clone(), self.global_value(index)))
            .collect();
        let lists: BTreeMap<_, _> = self
            .program
            .list_names
            .iter()
            .enumerate()
            .map(|(index, id)| (id.clone(), self.list_values(index)))
            .collect();
        serde_json::json!({
            "sequence":self.sequence, "time":self.time,
            "scene":self.program.scenes[self.current_scene].id,
            "actors":actors, "variables":variables, "lists":lists,
            "costume_turn":self.program.costume_turn,
            "ranking_variable":self.cloud.ranking.map(|i| &self.program.cloud[i].id),
        })
    }
    pub fn numeric_lists(&self) -> Vec<Vec<f64>> {
        self.lists
            .iter()
            .map(|l| l.borrow().iter().map(Cell::number).collect())
            .collect()
    }
    /// Current text of a global variable by id.
    pub fn variable_text(&self, id: &str) -> String {
        self.program
            .variable_names
            .iter()
            .position(|n| n == id)
            .map_or_else(String::new, |i| {
                self.global_value(i)
                    .text_with_js_nonfinite(self.program.semantics == RuntimeSemantics::KnCurrent)
            })
    }
    pub fn list_values(&self, index: usize) -> Vec<Cell> {
        self.lists[index].borrow().clone()
    }
    pub fn set_pressed_keys(&mut self, keys: impl IntoIterator<Item = String>) {
        let pressed = keys.into_iter().collect::<BTreeSet<_>>();
        self.released
            .extend(self.pressed.difference(&pressed).cloned());
        self.pressed = pressed;
    }
    pub fn recycle_lines(&mut self, mut lines: Vec<f32>) {
        lines.clear();
        self.lines = lines;
    }
    /// Fixes the random sequence (seeded from the clock by default).
    pub fn set_random_seed(&mut self, seed: u64) {
        self.random_state = seed | 1;
    }
    /// Interpreter only: the reference behaviour for differential tests.
    pub fn disable_jit(&mut self) {
        self.jit = None;
    }
    pub fn new(program: Program) -> Self {
        let _timing = crate::import_perf::span("engine_init_jit");
        // Private list references can be nested inside ListRef::Expression and
        // reporter calls. Conservatively keep the entire private-variable program
        // interpreted until all native helpers understand entity ownership. Purely
        // global projects retain the exact same JIT and indexed-slot fast path.
        let jit = if program.actor_variable_names.is_empty() {
            jit::Jit::new(program.ops.len())
        } else {
            None
        };
        let slots = program.initial.clone();
        let lists = program
            .initial_lists
            .iter()
            .map(|v| Rc::new(RefCell::new(v.iter().map(Cell::deep_clone).collect())))
            .collect();
        let values = program
            .initial_values
            .iter()
            .map(|v| v.as_ref().map(Cell::deep_clone))
            .collect();
        let sprites = program.sprites.clone();
        let sprites = sprites
            .into_iter()
            .map(|mut s| {
                s.variables = s
                    .variables
                    .iter()
                    .map(|(&k, v)| (k, v.deep_clone()))
                    .collect();
                s
            })
            .collect::<Vec<_>>();
        let dirty = vec![true; sprites.len()];
        let scene_orders = initial_orders(&program);
        let order = scene_orders[program.initial_scene].clone();
        let current_scene = program.initial_scene;
        let has_bump_scripts = program
            .scripts
            .iter()
            .any(|s| matches!(s.event, ScriptEvent::Bump(..)));
        Self {
            cloud: cloud::State::default(),
            scheduler_tick: 0,
            trace_filter: None,
            trace_truncated: false,
            warp_iterations: 0,
            oracle_events: None,
            physics: None,
            pen_rasters: vec![None; program.scenes.len()],
            bump_state: Default::default(),
            has_bump_scripts,
            program,
            slots,
            lists,
            values,
            pressed: Default::default(),
            released: BTreeSet::new(),
            mouse: [0.0; 2],
            pen_layer: 0,
            random_state: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(1, |t| t.as_nanos() as u64)
                | 1,
            sprites,
            tasks: vec![],
            next_task_id: 0,
            received: BTreeSet::new(),
            lines: Vec::with_capacity(4096),
            text_stamps: vec![],
            pen_fills: vec![],
            logs: vec![],
            audio_commands: vec![],
            clear: true,
            time: 0.0,
            timer: 0.0,
            timer_running: true,
            timer_visible: false,
            current_task: 0,
            sequence: 0,
            cursor: 0,
            ready: VecDeque::new(),
            dirty,
            reset: true,
            value_error: None,
            evaluation_cache: vec![],
            stopped: false,
            restart: false,
            reporter_depth: 0,
            jit,
            jit_error: None,
            order,
            current_scene,
            scene_orders,
            scene_changed: true,
            next_transition: None,
            transition: None,
            order_dirty: true,
            removed: vec![],
            free_slots: vec![],
            clone_serial: 0,
            clones: 0,
            clone_counts: BTreeMap::new(),
            clone_orders: BTreeMap::new(),
            asks: VecDeque::new(),
            next_ask: 1,
            image_stamps: vec![],
            monitors: vec![],
            audio_waits: vec![],
            next_audio_wait: 1,
            answer: Cell::Text("".into()),
            choice: (0.0, Cell::Text("".into())),
            tz_offset_min: 0.0,
            pointer_down: false,
            pointer_clicked: false,
            pointer_released: false,
        }
    }
    pub fn start(&mut self) {
        let cloud_values = self.cloud_restart_values();
        self.cloud.ranking = None;
        self.physics = None;
        self.slots.clone_from(&self.program.initial);
        self.lists = self
            .program
            .initial_lists
            .iter()
            .map(|v| Rc::new(RefCell::new(v.iter().map(Cell::deep_clone).collect())))
            .collect();
        self.values = self
            .program
            .initial_values
            .iter()
            .map(|v| v.as_ref().map(Cell::deep_clone))
            .collect();
        self.restore_cloud(cloud_values);
        self.pressed.clear();
        self.released.clear();
        self.mouse = [0.0; 2];
        self.pen_layer = 0;
        self.timer_visible = false;
        self.sprites.clone_from(&self.program.sprites);
        for sprite in &mut self.sprites {
            sprite.variables = sprite
                .variables
                .iter()
                .map(|(&k, v)| (k, v.deep_clone()))
                .collect();
        }
        self.dirty.resize(self.sprites.len(), true);
        self.scene_orders = initial_orders(&self.program);
        self.current_scene = self.program.initial_scene;
        self.order = self.scene_orders[self.current_scene].clone();
        self.scene_changed = true;
        self.next_transition = None;
        self.transition = None;
        self.order_dirty = true;
        self.removed.clear();
        self.free_slots.clear();
        self.clone_serial = 0;
        self.clones = 0;
        self.clone_counts.clear();
        self.clone_orders.clear();
        self.asks.clear();
        self.image_stamps.clear();
        self.monitors.clear();
        self.audio_waits.clear();
        self.answer = Cell::Text("".into());
        self.choice = (0.0, Cell::Text("".into()));
        self.tasks.clear();
        self.next_task_id = 0;
        self.received.clear();
        self.value_error = None;
        self.stopped = false;
        self.initialize_legacy_physics();
        self.time = 0.0;
        self.timer = 0.0;
        self.timer_running = true;
        self.clear = true;
        self.lines.clear();
        self.text_stamps.clear();
        self.pen_fills.clear();
        self.logs.clear();
        self.audio_commands.clear();
        self.dirty.fill(true);
        self.reset = true;
        self.cursor = 0;
        self.bump_state.clear();
        self.pen_rasters.iter_mut().for_each(|r| *r = None);
        let scene_id = self.program.scenes[self.current_scene].id.clone();
        self.dispatch(|event| {
            matches!(
                event,
                ScriptEvent::Start | ScriptEvent::K4GlobalStart | ScriptEvent::K4SceneActivate
            ) || matches!(event, ScriptEvent::K4Backdrop(id) if id == &scene_id)
        });
        // Originals only. Clone when behaviour has no official oracle yet;
        // do not infer clone responders from other event types.
        for script in 0..self.program.scripts.len() {
            if matches!(self.program.scripts[script].event, ScriptEvent::KnWhen) {
                self.spawn(script, self.program.scripts[script].actor);
            }
        }
    }
    pub fn key(&mut self, key: &str) {
        self.key_event(key, true);
    }
    pub fn key_event(&mut self, key: &str, down: bool) {
        if down {
            self.pressed.insert(key.into());
        } else {
            self.pressed.remove(key);
            self.released.insert(key.into());
        }
        if down && self.program.semantics == RuntimeSemantics::Kitten4 {
            // Concrete down hats on originals and split instances are state
            // responders, serviced at tick entry. Official mirrors do not run
            // concrete down hats (semantics-keys.bcm). Any-key policy unverified.
            if !self.stopped {
                for script in 0..self.program.scripts.len() {
                    let spec = &self.program.scripts[script];
                    if !matches!(&spec.event, ScriptEvent::Key(k, true) if k == key || k == "any")
                        || !self.in_active_scene(spec.actor)
                    {
                        continue;
                    }
                    let actor = spec.actor;
                    let any = matches!(&spec.event, ScriptEvent::Key(k, _) if k == "any");
                    if any {
                        for target in self.instances(actor) {
                            self.spawn(script, target);
                        }
                    }
                }
            }
        } else {
            self.dispatch(|event| matches!(event, ScriptEvent::Key(k,d) if (k == key || k == "any") && *d == down));
        }
    }
    pub fn set_mouse(&mut self, x: f64, y: f64) {
        if x.is_finite() && y.is_finite() {
            self.mouse = [x, y];
        }
    }
    /// Costume sizes and opacity masks measured by the viewer after decoding.
    pub fn set_costume(&mut self, id: &str, mut costume: Costume) {
        if costume.width.is_finite() && costume.height.is_finite() {
            costume.center_point = costume
                .center_point
                .map(|n| if n.is_finite() { n } else { 0.0 });
            self.invalidate_physics_costume(id);
            self.program.costumes.insert(id.to_owned(), costume);
        }
    }
    /// Resumes a task waiting in play-and-wait.
    pub fn audio_finished(&mut self, wait: u64) {
        if let Some(at) = self.audio_waits.iter().position(|(_, w)| *w == wait) {
            let (task, _) = self.audio_waits.remove(at);
            if let Some(task) = self.tasks.iter_mut().find(|t| t.id == task && !t.done) {
                task.pending = task.pending.saturating_sub(1);
            }
        }
    }
    /// Moves a draggable sprite (player drag gesture).
    pub fn drag(&mut self, id: &str, x: f64, y: f64) {
        if !(x.is_finite() && y.is_finite()) || self.stopped {
            return;
        }
        if let Some(i) = self
            .sprites
            .iter()
            .position(|a| a.id == id && a.alive && a.draggable)
        {
            let old = (self.sprites[i].x, self.sprites[i].y);
            self.sprites[i].x = x;
            self.sprites[i].y = y;
            self.dirty[i] = true;
            if self.sprites[i].fill_path.is_some() {
                self.line(i, old);
            }
        }
    }
    pub fn swipe(&mut self, direction: &str) {
        self.dispatch(|event| matches!(event, ScriptEvent::Swipe(d) if d == direction));
    }
    /// The question currently shown to the viewer, if any.
    pub fn pending_ask(&self) -> Option<&AskRequest> {
        self.asks.front()
    }
    /// Answers the current question and resumes the task that asked it.
    /// `choice` is the 1-based option for ask-and-choose.
    pub fn answer(&mut self, id: u64, text: &str, choice: Option<usize>) {
        let Some(ask) = self.asks.front() else { return };
        if ask.id != id {
            return;
        }
        let ask = self.asks.pop_front().unwrap();
        if let Some(choices) = &ask.choices {
            let index = choice
                .filter(|i| (1..=choices.len()).contains(i))
                .unwrap_or(0);
            self.choice = (
                index as f64,
                Cell::Text(
                    index
                        .checked_sub(1)
                        .map_or("", |i| choices[i].as_str())
                        .into(),
                ),
            );
            self.answer = self.choice.1.clone();
        } else {
            self.answer = Cell::Text(text.chars().take(10_000).collect::<String>().into());
        }
        if let Some(task) = self.tasks.iter_mut().find(|t| t.id == ask.task && !t.done) {
            task.pending = task.pending.saturating_sub(1);
        }
    }
    /// Viewer's UTC offset in minutes (local = UTC + offset) for time reporters.
    pub fn set_utc_offset(&mut self, minutes: f64) {
        if minutes.is_finite() && minutes.abs() <= 24.0 * 60.0 {
            self.tz_offset_min = minutes;
        }
    }
    pub fn pointer_event(&mut self, target: &str, state: &str, x: f64, y: f64) {
        self.set_mouse(x, y);
        match state {
            "mouse_down" => self.pointer_down = true,
            "mouse_up" => {
                self.pointer_down = false;
                self.pointer_released = true;
            }
            "mouse_click" => self.pointer_clicked = true,
            _ => {}
        }
        if self.stopped {
            return;
        }
        let hit = self
            .sprites
            .iter()
            .position(|sprite| sprite.id == target && sprite.visible && sprite.alive);
        for script in 0..self.program.scripts.len() {
            let ScriptEvent::Pointer(id, s) = &self.program.scripts[script].event else {
                continue;
            };
            if self.program.sprites[self.program.scripts[script].actor].scene != self.current_scene
            {
                continue;
            }
            if s != state {
                continue;
            }
            let actor = self.program.scripts[script].actor;
            if id == "--screen" {
                self.spawn(script, actor);
                continue;
            }
            let Some(hit) = hit else { continue };
            if self.program.semantics == RuntimeSemantics::Kitten4
                && self.sprites[hit].empty_code
                && self.sprites[hit].origin == actor
            {
                continue;
            }
            // The script listens to actor `id`; a click on one of its clones counts.
            let origin = self.sprites[hit].origin;
            if self.program.sprites[origin].id != *id {
                continue;
            }
            // A sprite's own click script runs on the clicked instance.
            self.spawn(script, if origin == actor { hit } else { actor });
        }
    }
    fn in_active_scene(&self, actor: usize) -> bool {
        self.program.sprites[actor].scene == self.current_scene
    }
    /// Live sprite indices running an actor's scripts: the original and its clones.
    fn instances(&self, actor: usize) -> Vec<usize> {
        (0..self.sprites.len())
            .filter(|&i| {
                self.sprites[i].alive
                    && self.sprites[i].origin == actor
                    && (self.program.semantics != RuntimeSemantics::Kitten4
                        || !self.sprites[i].empty_code)
            })
            .collect()
    }
    fn spawn(&mut self, script: usize, actor: usize) -> Option<usize> {
        if self.tasks.len() >= 4096 || !self.sprites[actor].alive {
            return None;
        }
        let mut task = Task::new(
            self.next_task_id,
            &self.program.scripts[script],
            &self.program,
        );
        task.actor = actor;
        task.created = self.scheduler_tick;
        task.script = script;
        task.global_start = matches!(
            self.program.scripts[script].event,
            ScriptEvent::K4GlobalStart
        );
        task.kn_when = matches!(self.program.scripts[script].event, ScriptEvent::KnWhen);
        self.next_task_id += 1;
        self.tasks.push(task);
        self.trace_task("start", self.tasks.len() - 1, None);
        Some(self.tasks.len() - 1)
    }
    fn dispatch(&mut self, matches: impl Fn(&ScriptEvent) -> bool) {
        if self.stopped {
            return;
        }
        for script in 0..self.program.scripts.len() {
            if !matches(&self.program.scripts[script].event)
                || (!matches!(
                    self.program.scripts[script].event,
                    ScriptEvent::K4GlobalStart
                ) && !self.in_active_scene(self.program.scripts[script].actor))
            {
                continue;
            }
            // The start event runs originals only; other events reach clones too.
            let actor = self.program.scripts[script].actor;
            let targets = if matches!(
                self.program.scripts[script].event,
                ScriptEvent::Start
                    | ScriptEvent::K4GlobalStart
                    | ScriptEvent::K4SceneActivate
                    | ScriptEvent::K4Backdrop(_)
            ) {
                vec![actor]
            } else {
                self.instances(actor)
            };
            for target in targets {
                self.spawn(script, target);
            }
        }
    }
    /// K4 concrete down hats are single-flight per original script/actor. A
    /// waiting, pending or budget-suspended task still owns the responder. Only
    /// tick entry can retrigger it, so completion never restarts it in this tick.
    fn dispatch_held_keys(&mut self) {
        if self.stopped || self.program.semantics != RuntimeSemantics::Kitten4 {
            return;
        }
        for script in 0..self.program.scripts.len() {
            let spec = &self.program.scripts[script];
            let ScriptEvent::Key(key, true) = &spec.event else {
                continue;
            };
            let actor = spec.actor;
            if key == "any" || !self.pressed.contains(key) || !self.in_active_scene(actor) {
                continue;
            }
            for target in self.instances(actor) {
                if !self
                    .tasks
                    .iter()
                    .any(|task| !task.done && task.script == script && task.actor == target)
                {
                    self.spawn(script, target);
                }
            }
        }
    }
    fn broadcast(&mut self, message: String, payload: Cell, wait: bool) -> Result<()> {
        if message == "?" {
            return Ok(());
        }
        self.received.insert(message.clone());
        let parent = self.current_task;
        // Evaluate listener expressions in the sender context; each receiver gets
        // fresh script locals and its own payload slot (list identity is preserved).
        for i in 0..self.program.scripts.len() {
            let script = self.program.scripts[i].clone();
            let ScriptEvent::Broadcast(value, with_param) = script.event else {
                continue;
            };
            if !self.in_active_scene(script.actor) {
                continue;
            }
            if self.eval_value(value, script.actor).text() != message {
                continue;
            }
            for target in self.instances(script.actor) {
                ensure!(self.tasks.len() < 4096, "broadcast task limit exceeded");
                let mut task = Task::new(self.next_task_id, &script, &self.program);
                task.actor = target;
                task.script = i;
                task.created = self.scheduler_tick;
                self.next_task_id += 1;
                if with_param {
                    task.payload = payload.clone();
                }
                if wait {
                    task.waiter = Some(self.tasks[parent].id);
                    self.tasks[parent].pending += 1;
                }
                if self.program.semantics == RuntimeSemantics::KnCurrent {
                    self.ready.push_back(self.tasks.len());
                }
                self.tasks.push(task);
                self.trace_task("start", self.tasks.len() - 1, None);
            }
        }
        Ok(())
    }
    fn finish_task(&mut self, index: usize) {
        if self.tasks[index].done {
            return;
        }
        self.tasks[index].done = true;
        let id = self.tasks[index].id;
        self.asks.retain(|ask| ask.task != id);
        self.audio_waits.retain(|(task, _)| *task != id);
        if let Some(id) = self.tasks[index].waiter.take()
            && let Some(parent) = self
                .tasks
                .iter()
                .position(|task| task.id == id && !task.done)
        {
            self.tasks[parent].pending -= 1;
            if self.tasks[parent].pending == 0
                && !self.ready.contains(&parent)
                && self.program.semantics == RuntimeSemantics::KnCurrent
            {
                self.ready.push_back(parent);
            }
        }
    }
    #[inline]
    fn eval(&mut self, expr: Expr, actor: usize) -> f64 {
        self.operand(expr.end as usize - 1, actor)
    }
    /// Evaluates the postfix subtree rooted at `pc`, left operand first. Kept small:
    /// numeric leaves and arithmetic stay here, everything else is out of line.
    #[inline(always)]
    fn node(&mut self, pc: usize, actor: usize) -> f64 {
        if self.program.deep_values.is_empty() {
            return self.node_one::<false>(pc, actor);
        }
        if let Some(value) = self
            .evaluation_cache
            .last_mut()
            .and_then(|c| c.get_mut(&(false, pc)))
            .and_then(VecDeque::pop_front)
        {
            return value.number();
        }
        self.node_one::<true>(pc, actor)
    }
    fn node_one<const CACHED: bool>(&mut self, pc: usize, actor: usize) -> f64 {
        // The common scalar fast path remains allocation-free. Composite numeric
        // trees are already postfix, so no traversal/call stack is necessary.
        if pc - self.program.expression_starts[pc] as usize >= 64
            && matches!(
                self.program.expressions[pc],
                ExprOp::Binary(_) | ExprOp::Unary(_) | ExprOp::Random | ExprOp::ListItem(_, false)
            )
        {
            return self.node_iterative(pc, actor);
        }
        match self.program.expressions[pc] {
            ExprOp::Constant(n) => n,
            ExprOp::Slot(s) => self.slots[s],
            ExprOp::Binary(op) => {
                let right = pc - 1;
                let left = self.program.expression_starts[right] as usize - 1;
                let a = self.operand_one::<CACHED>(left, actor);
                let b = self.operand_one::<CACHED>(right, actor);
                op.apply(a, b)
            }
            ExprOp::Unary(op) => {
                let a = self.operand_one::<CACHED>(pc - 1, actor);
                op.apply(a)
            }
            ExprOp::Local(s) => self.tasks[self.current_task].locals[s],
            // Indexed read of a global list: borrow in place, no handle clone.
            ExprOp::ListItem(ListRef::Global(list), false) => {
                let at = self.operand_one::<CACHED>(pc - 1, actor);
                self.check_list_index(at);
                let values = self.lists[list as usize].borrow();
                read_list_index(at, values.len(), self.program.semantics)
                    .and_then(|i| values.get(i))
                    .map_or(f64::NAN, Cell::number)
            }
            ExprOp::Value(i) => self.eval_value(i, actor).number(),
            ExprOp::Truth(i) => u8::from(self.eval_value(i, actor).truth()) as f64,
            _ => self.node_slow(pc, actor),
        }
    }
    #[inline(never)]
    fn node_iterative(&mut self, pc: usize, actor: usize) -> f64 {
        let start = self.program.expression_starts[pc] as usize;
        let mut values = Vec::new();
        for at in start..=pc {
            let value = match self.program.expressions[at] {
                ExprOp::Binary(op) => {
                    let b = values.pop().unwrap();
                    let a = values.pop().unwrap();
                    op.apply(a, b)
                }
                ExprOp::Unary(op) => op.apply(values.pop().unwrap()),
                ExprOp::Random => {
                    let b = values.pop().unwrap();
                    let a = values.pop().unwrap();
                    let (a, b) = if self.program.semantics == RuntimeSemantics::Kitten4 {
                        (a, b)
                    } else {
                        ((a + 0.5_f64).floor(), (b + 0.5_f64).floor())
                    };
                    self.random_state ^= self.random_state << 13;
                    self.random_state ^= self.random_state >> 7;
                    self.random_state ^= self.random_state << 17;
                    let unit = (self.random_state >> 11) as f64 / ((1u64 << 53) as f64);
                    (unit * (b - a + 1.0)).floor() + a
                }
                ExprOp::ListItem(list, false) => {
                    let index = values.pop().unwrap();
                    self.check_list_index(index);
                    self.resolve_list(list).map_or(f64::NAN, |list| {
                        let list = list.borrow();
                        read_list_index(index, list.len(), self.program.semantics)
                            .and_then(|i| list.get(i))
                            .map_or(f64::NAN, Cell::number)
                    })
                }
                _ => self.operand(at, actor),
            };
            values.push(value);
        }
        values.pop().unwrap()
    }
    #[inline(always)]
    fn operand(&mut self, pc: usize, actor: usize) -> f64 {
        if self.program.deep_values.is_empty() {
            self.operand_one::<false>(pc, actor)
        } else {
            self.operand_one::<true>(pc, actor)
        }
    }
    #[inline(always)]
    fn operand_one<const CACHED: bool>(&mut self, pc: usize, actor: usize) -> f64 {
        if CACHED
            && let Some(value) = self
                .evaluation_cache
                .last_mut()
                .and_then(|c| c.get_mut(&(false, pc)))
                .and_then(VecDeque::pop_front)
        {
            return value.number();
        }
        match self.program.expressions[pc] {
            ExprOp::Constant(n) => n,
            ExprOp::Slot(s) => self.slots[s],
            _ => self.node_one::<CACHED>(pc, actor),
        }
    }
    #[inline(never)]
    fn node_slow(&mut self, pc: usize, actor: usize) -> f64 {
        match self.program.expressions[pc] {
            ExprOp::Constant(n) => n,
            ExprOp::Slot(s) => self.slots[s],
            ExprOp::Local(s) => self.tasks[self.current_task].locals[s],
            ExprOp::Value(i) => self.eval_value(i, actor).number(),
            ExprOp::Truth(i) => u8::from(self.eval_value(i, actor).truth()) as f64,
            ExprOp::Key(i, down) => {
                let keys = if down { &self.pressed } else { &self.released };
                let key = &self.program.strings[i];
                u8::from(if key == "any" {
                    !keys.is_empty()
                } else {
                    keys.contains(key)
                }) as f64
            }
            ExprOp::Coordinate(target, y) => {
                let target = if target == usize::MAX { actor } else { target };
                let coordinate = if y {
                    self.sprites[target].y
                } else {
                    self.sprites[target].x
                };
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    k4_round(coordinate)
                } else {
                    coordinate
                }
            }
            ExprOp::Orientation(target) => {
                let target = if target == usize::MAX { actor } else { target };
                self.sprites[target].direction
            }
            ExprOp::Scale(target) => {
                let target = if target == usize::MAX { actor } else { target };
                self.sprites[target].scale
            }
            ExprOp::Costume(target) => {
                let target = if target == usize::MAX { actor } else { target };
                let sprite = &self.sprites[target];
                sprite
                    .styles
                    .iter()
                    .position(|id| Some(id) == sprite.style.as_ref())
                    .map_or(0.0, |i| (i + 1) as f64)
            }
            ExprOp::X => self.sprites[actor].x,
            ExprOp::Y => self.sprites[actor].y,
            ExprOp::Direction => self.sprites[actor].direction,
            ExprOp::Timer => self.timer,
            ExprOp::Mouse(y) => self.mouse[usize::from(y)],
            ExprOp::TextLength(i) => self.eval_value(i, actor).text().encode_utf16().count() as f64,
            ExprOp::Distance(target) => {
                let (x, y) = self.point(target, actor);
                let a = &self.sprites[actor];
                let distance = (x - a.x).hypot(y - a.y);
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    k4_round(distance)
                } else {
                    distance
                }
            }
            ExprOp::Time(unit) => local_time(self.tz_offset_min)[unit as usize],
            ExprOp::Effect(target, scope) => {
                let a = &self.sprites[if target == usize::MAX { actor } else { target }];
                if scope == 1 {
                    (1.0 - a.opacity) * 100.0
                } else if scope == 2 && self.program.semantics == RuntimeSemantics::Kitten4 {
                    a.effects[2] + 100.0
                } else {
                    a.effects[scope as usize]
                }
            }
            ExprOp::CloneCount(target) => {
                let origin = self.sprites[if target == usize::MAX { actor } else { target }].origin;
                (0..self.sprites.len())
                    .filter(|&i| {
                        self.sprites[i].alive && self.sprites[i].origin == origin && i != origin
                    })
                    .count() as f64
            }
            ExprOp::CloneIndex => self.sprites[actor].clone_index as f64,
            ExprOp::PhysicsProperty(property) => self.physics_property(actor, property),
            ExprOp::LegacyPhysicsProperty(target, property) => self.legacy_physics_property(
                if target == usize::MAX { actor } else { target },
                property,
            ),
            ExprOp::Touching(subject, other) => {
                // `--self` as the other side means the running actor, whatever the subject.
                let other = if other == usize::MAX { actor } else { other };
                let hit = if subject == usize::MAX {
                    self.touching(actor, other)
                } else if (TARGET_CAMP - 3..=TARGET_CAMP).contains(&subject) {
                    let camp = (TARGET_CAMP - subject) as u8;
                    let members: Vec<usize> = self.camp_members(camp).collect();
                    members.into_iter().any(|i| self.touching(i, other))
                } else {
                    // An actor subject includes its clones (official getActorIdsFromOption).
                    let origin = self.sprites[subject].origin;
                    (0..self.sprites.len()).any(|i| {
                        self.sprites[i].alive
                            && self.sprites[i].origin == origin
                            && self.touching(i, other)
                    })
                };
                u8::from(hit) as f64
            }
            ExprOp::TouchingColor(subject, color) => {
                let hit = if subject == usize::MAX {
                    self.touching_color(actor, color)
                } else if (TARGET_CAMP - 3..=TARGET_CAMP).contains(&subject) {
                    let members: Vec<usize> =
                        self.camp_members((TARGET_CAMP - subject) as u8).collect();
                    members.into_iter().any(|i| self.touching_color(i, color))
                } else {
                    let origin = self.sprites[subject].origin;
                    (0..self.sprites.len()).any(|i| {
                        self.sprites[i].alive
                            && self.sprites[i].origin == origin
                            && self.touching_color(i, color)
                    })
                };
                u8::from(hit) as f64
            }
            ExprOp::OutOfBounds(subject, edge) => {
                let subject = if subject == usize::MAX {
                    actor
                } else {
                    subject
                };
                let (l, r, b, t) = self.bounds(subject);
                let (w, h) = (self.program.width / 2.0, self.program.height / 2.0);
                u8::from(match edge {
                    1 => t > h,
                    2 => b < -h,
                    3 => l < -w,
                    4 => r > w,
                    _ => t > h || b < -h || l < -w || r > w,
                }) as f64
            }
            ExprOp::MouseDown(state) => u8::from(match state {
                0 => self.pointer_down,
                1 => self.pointer_clicked,
                _ => self.pointer_released,
            }) as f64,
            ExprOp::Random => {
                let right = pc - 1;
                let left = self.program.expression_starts[right] as usize - 1;
                let a = self.node(left, actor);
                let b = self.node(right, actor);
                // Tn6a/random does not round fractional endpoints (unlike KN).
                let (a, b) = if self.program.semantics == RuntimeSemantics::Kitten4 {
                    (a, b)
                } else {
                    ((a + 0.5).floor(), (b + 0.5).floor())
                };
                self.random_state ^= self.random_state << 13;
                self.random_state ^= self.random_state >> 7;
                self.random_state ^= self.random_state << 17;
                let unit = (self.random_state >> 11) as f64 / ((1u64 << 53) as f64);
                (unit * (b - a + 1.0)).floor() + a
            }
            ExprOp::Range(depth) => {
                let ranges = &self.tasks[self.current_task].ranges;
                ranges[ranges.len() - 1 - depth].value
            }
            ExprOp::ListLength(i) => self
                .resolve_list(i)
                .map_or(f64::NAN, |v| v.borrow().len() as f64),
            ExprOp::ListItem(i, last) => {
                let at = if last {
                    None
                } else {
                    Some(self.node(pc - 1, actor))
                };
                if let Some(at) = at {
                    self.check_list_index(at);
                }
                self.resolve_list(i).map_or(f64::NAN, |v| {
                    let values = v.borrow();
                    let at = match at {
                        None => values.len().checked_sub(1),
                        Some(at) => read_list_index(at, values.len(), self.program.semantics),
                    };
                    at.and_then(|i| values.get(i))
                        .map_or(f64::NAN, Cell::number)
                })
            }
            ExprOp::Binary(op) => {
                let right = pc - 1;
                let left = self.program.expression_starts[right] as usize - 1;
                let a = self.node(left, actor);
                let b = self.node(right, actor);
                op.apply(a, b)
            }
            ExprOp::Unary(op) => {
                let a = self.node(pc - 1, actor);
                op.apply(a)
            }
        }
    }
    /// Runs a reporter procedure to completion on the current task. Yields and
    /// waits inside it do not suspend (it must produce a value now); runaway
    /// bodies and deep recursion become value errors instead of hangs.
    fn call_reporter(&mut self, procedure: usize, args: usize, actor: usize) -> Cell {
        if self.value_error.is_some() {
            return Cell::Null;
        }
        if self.reporter_depth >= 200 {
            self.value_error = Some("reporter procedure recursion exceeds 200".into());
            return Cell::Null;
        }
        let count = self.program.call_arguments[args].len();
        let mut parameters = Vec::with_capacity(count);
        for k in 0..count {
            let value = self.program.call_arguments[args][k];
            parameters.push(self.eval_value(value, actor));
        }
        let index = self.current_task;
        let task = &mut self.tasks[index];
        let depth = task.calls.len();
        task.calls.push(CallFrame {
            pc: task.pc,
            parameters: std::mem::replace(&mut task.parameters, parameters),
            loops: task.loops.len(),
            ranges: task.ranges.len(),
        });
        let saved_returned = task.returned.take();
        let (wake, anim) = (task.wake, task.anim);
        let wait = (task.wait_started, task.wait_finished);
        task.pc = self.program.procedure_entries[procedure];
        self.reporter_depth += 1;
        let mut steps = 0usize;
        while self.tasks[index].calls.len() > depth && !self.tasks[index].done {
            steps += 1;
            if steps > 1_000_000 {
                self.value_error = Some("reporter procedure did not return".into());
                break;
            }
            let pc = self.tasks[index].pc;
            let op = self.program.ops[pc];
            self.trace_task("block", index, Some(pc));
            let lengths = self.trace_list_lengths();
            self.tasks[index].pc += 1;
            let result = self.exec(index, pc, op, actor);
            self.trace_list_changes(index, pc, lengths);
            if let Err(error) = result {
                self.value_error = Some(format!("{error:#}"));
                break;
            }
            if self.value_error.is_some() {
                break;
            }
        }
        self.reporter_depth -= 1;
        let task = &mut self.tasks[index];
        // Unwind if the body failed before returning.
        while task.calls.len() > depth {
            let call = task.calls.pop().unwrap();
            task.pc = call.pc;
            task.parameters = call.parameters;
            task.loops.truncate(call.loops);
            task.ranges.truncate(call.ranges);
        }
        task.wake = wake;
        task.anim = anim;
        (task.wait_started, task.wait_finished) = wait;
        std::mem::replace(&mut task.returned, saved_returned).unwrap_or(Cell::Null)
    }
    fn monitor_values(&self) -> Vec<Monitor> {
        let mut out = vec![];
        for (i, visible) in self.monitors.iter().enumerate() {
            if !visible {
                continue;
            }
            let (id, list, target) = &self.program.monitor_targets[i];
            let value = if let Some(&(owner, slot)) = self.program.actor_monitors.get(&i) {
                self.sprites[owner]
                    .variables
                    .get(&slot)
                    .map_or_else(String::new, Cell::text)
            } else if *list {
                let items = self.lists[*target].borrow();
                let mut text = items
                    .iter()
                    .take(100)
                    .map(Cell::text)
                    .collect::<Vec<_>>()
                    .join("\n");
                if items.len() > 100 {
                    text.push_str("\n…");
                }
                text
            } else {
                self.global_value(*target).text()
            };
            out.push(Monitor {
                id: id.clone(),
                name: self.program.display_names.get(id).unwrap_or(id).clone(),
                list: *list,
                value,
            });
        }
        out
    }
    /// Exactly the viewer's spriteGeometry + actorGeometry. Frames and image
    /// stamps subtract costume_turn before reaching the viewer; do that here too.
    fn geometry(&self, i: usize) -> Option<CostumeGeometry<'_>> {
        let a = &self.sprites[i];
        let (costume, w, h, pivot) = if let Some(text) = &a.text {
            let (w, h) = text.extent();
            (&TEXT_COSTUME, w, h, [0.0; 2])
        } else {
            let costume = self.program.costumes.get(a.style.as_deref()?)?;
            (costume, costume.width, costume.height, costume.center_point)
        };
        let scale = a.scale / 100.0;
        let mut width = w * scale * a.size_x / 100.0 * if a.flip_x { -1.0 } else { 1.0 };
        let height = h * scale * a.size_y / 100.0 * if a.flip_y { -1.0 } else { 1.0 };
        let direction = a.direction - self.program.costume_turn;
        let angle = if a.rotation_type == 0 {
            direction.to_radians()
        } else {
            if a.rotation_type == 1 && (direction % 360.0 + 540.0) % 360.0 - 180.0 < 0.0 {
                width = -width;
            }
            0.0
        };
        let (s, c) = angle.sin_cos();
        // Use signed drawn dimensions, just as actorGeometry does. Avoid 0/0
        // for empty images; their dimensions still make them non-hittable.
        let dx = if w == 0.0 { 0.0 } else { -pivot[0] * width / w };
        let dy = if h == 0.0 { 0.0 } else { pivot[1] * height / h };
        Some(CostumeGeometry {
            costume,
            x: a.x + c * dx + s * dy,
            y: a.y - s * dx + c * dy,
            width,
            height,
            angle,
        })
    }
    /// Axis-aligned bounds (left, right, bottom, top) of a sprite on the stage.
    fn bounds(&self, i: usize) -> (f64, f64, f64, f64) {
        let a = &self.sprites[i];
        let Some(geometry) = self.geometry(i) else {
            return (a.x, a.x, a.y, a.y);
        };
        geometry.bounds()
    }
    /// Whether a stage point lies on an opaque part of sprite `i`.
    fn contains(&self, i: usize, x: f64, y: f64) -> bool {
        let Some(geometry) = self.geometry(i) else {
            return false;
        };
        let Some((u, v)) = geometry.uv(x, y) else {
            return false;
        };
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return false;
        }
        match &geometry.costume.mask {
            None => true,
            Some((mw, mh, bits)) => {
                let (px, py) = ((u * *mw as f64) as usize, (v * *mh as f64) as usize);
                let bit = py * mw + px;
                bits.get(bit / 8)
                    .is_some_and(|byte| byte >> (bit % 8) & 1 == 1)
            }
        }
    }
    fn touching(&self, subject: usize, other: usize) -> bool {
        let a = &self.sprites[subject];
        if !a.alive || !a.visible {
            return false;
        }
        if self.physics_touching(subject, other) == Some(true) {
            return true;
        }
        match other {
            TARGET_MOUSE => self.contains(subject, self.mouse[0], self.mouse[1]),
            TARGET_EDGE => {
                let (l, r, b, t) = self.bounds(subject);
                let (w, h) = (self.program.width / 2.0, self.program.height / 2.0);
                l <= -w || r >= w || b <= -h || t >= h
            }
            side if (TARGET_EDGE_SIDE - 3..=TARGET_EDGE_SIDE).contains(&side) => {
                let (l, r, b, t) = self.bounds(subject);
                let (w, h) = (self.program.width / 2.0, self.program.height / 2.0);
                match TARGET_EDGE_SIDE - side {
                    0 => t >= h,
                    1 => b <= -h,
                    2 => l <= -w,
                    _ => r >= w,
                }
            }
            camp if (TARGET_CAMP - 3..=TARGET_CAMP).contains(&camp) => {
                let camp = (TARGET_CAMP - camp) as u8;
                self.camp_members(camp)
                    .any(|j| j != subject && self.sprites[j].visible && self.overlap(subject, j))
            }
            other => {
                let origin = self.sprites[if other == usize::MAX { subject } else { other }].origin;
                (0..self.sprites.len()).any(|j| {
                    j != subject
                        && self.sprites[j].alive
                        && self.sprites[j].visible
                        && self.sprites[j].origin == origin
                        && self.overlap(subject, j)
                })
            }
        }
    }
    /// Sampled pixel overlap inside the intersection of both bounds.
    fn overlap(&self, a: usize, b: usize) -> bool {
        let (al, ar, ab, at) = self.bounds(a);
        let (bl, br, bb, bt) = self.bounds(b);
        let (l, r, bottom, t) = (al.max(bl), ar.min(br), ab.max(bb), at.min(bt));
        if l > r || bottom > t {
            return false;
        }
        // At most 64x64 samples, at least one per stage unit when smaller.
        let nx = ((r - l).ceil() as usize).clamp(1, 64);
        let ny = ((t - bottom).ceil() as usize).clamp(1, 64);
        for iy in 0..ny {
            let y = bottom + (iy as f64 + 0.5) * (t - bottom) / ny as f64;
            for ix in 0..nx {
                let x = l + (ix as f64 + 0.5) * (r - l) / nx as f64;
                if self.contains(a, x, y) && self.contains(b, x, y) {
                    return true;
                }
            }
        }
        false
    }
    /// Colour of sprite `i` at a stage point: (rgb, alpha) when opaque there.
    /// Needs the viewer's costume colours; effects other than opacity are ignored.
    fn color_at(&self, i: usize, x: f64, y: f64) -> Option<([f64; 3], f64)> {
        let a = &self.sprites[i];
        let geometry = self.geometry(i)?;
        let (u, v) = geometry.uv(x, y)?;
        self.costume_texel(geometry.costume, u, v)
            .map(|rgb| (rgb, a.opacity.clamp(0.0, 1.0)))
    }
    /// Costume colour at normalised (u, v), None where transparent or unknown.
    fn costume_texel(&self, costume: &Costume, u: f64, v: f64) -> Option<[f64; 3]> {
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return None;
        }
        let (mw, mh, bits) = costume.mask.as_ref()?;
        let (px, py) = ((u * *mw as f64) as usize, (v * *mh as f64) as usize);
        let cell = py * mw + px;
        if bits
            .get(cell / 8)
            .is_none_or(|byte| byte >> (cell % 8) & 1 == 0)
        {
            return None;
        }
        let rgb = costume.rgb.as_ref()?.get(cell * 3..cell * 3 + 3)?;
        Some([f64::from(rgb[0]), f64::from(rgb[1]), f64::from(rgb[2])])
    }
    fn raster_size(&self) -> (usize, usize) {
        (
            self.program.width.round().clamp(1.0, 4096.0) as usize,
            self.program.height.round().clamp(1.0, 4096.0) as usize,
        )
    }
    fn raster_mut(&mut self) -> Option<&mut Vec<u8>> {
        let (w, h) = self.raster_size();
        let raster = self.pen_rasters.get_mut(self.current_scene)?;
        Some(raster.get_or_insert_with(|| vec![0; w * h * 4]))
    }
    /// Source-over blend of straight RGBA (0..255 rgb, 0..1 alpha) into the raster.
    fn blend_pixel(raster: &mut [u8], at: usize, rgb: [f64; 3], alpha: f64) {
        let dst = &mut raster[at..at + 4];
        let da = f64::from(dst[3]) / 255.0;
        let out = alpha + da * (1.0 - alpha);
        if out <= 0.0 {
            return;
        }
        for k in 0..3 {
            let mixed = (rgb[k] * alpha + f64::from(dst[k]) * da * (1.0 - alpha)) / out;
            dst[k] = mixed.round().clamp(0.0, 255.0) as u8;
        }
        dst[3] = (out * 255.0).round() as u8;
    }
    /// Round-capped pen stroke into the scene's colour-sensing raster.
    fn raster_line(&mut self, from: (f64, f64), to: (f64, f64), size: f64, color: [f32; 4]) {
        let (w, h) = self.raster_size();
        let (hw, hh) = (w as f64 / 2.0, h as f64 / 2.0);
        let r = (size / 2.0).max(0.5);
        let rgb = [
            f64::from(color[0]) * 255.0,
            f64::from(color[1]) * 255.0,
            f64::from(color[2]) * 255.0,
        ];
        let alpha = f64::from(color[3]).clamp(0.0, 1.0);
        // Stage -> pixel: x right, y down from the top-left corner.
        let (ax, ay) = (from.0 + hw, hh - from.1);
        let (bx, by) = (to.0 + hw, hh - to.1);
        let x0 = (ax.min(bx) - r).floor().max(0.0) as usize;
        let x1 = ((ax.max(bx) + r).ceil().max(0.0) as usize).min(w);
        let y0 = (ay.min(by) - r).floor().max(0.0) as usize;
        let y1 = ((ay.max(by) + r).ceil().max(0.0) as usize).min(h);
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        let (ex, ey) = (bx - ax, by - ay);
        let len2 = ex * ex + ey * ey;
        let Some(raster) = self.raster_mut() else {
            return;
        };
        for py in y0..y1 {
            for px in x0..x1 {
                let (cx, cy) = (px as f64 + 0.5 - ax, py as f64 + 0.5 - ay);
                let t = if len2 > 0.0 {
                    ((cx * ex + cy * ey) / len2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let (dx, dy) = (cx - t * ex, cy - t * ey);
                if dx * dx + dy * dy <= r * r {
                    Self::blend_pixel(raster, (py * w + px) * 4, rgb, alpha);
                }
            }
        }
    }
    /// Nonzero winding fill at pixel centres, matching Canvas' default fill rule.
    fn raster_fill(&mut self, points: &[[f64; 2]], color: [f32; 4]) {
        let (w, h) = self.raster_size();
        let Some(raster) = self.raster_mut() else {
            return;
        };
        let rgb = [color[0], color[1], color[2]].map(|v| f64::from(v) * 255.0);
        let mut crossings = Vec::with_capacity(points.len());
        for py in 0..h {
            let y = h as f64 / 2.0 - py as f64 - 0.5;
            crossings.clear();
            for (a, b) in points
                .iter()
                .zip(points.iter().cycle().skip(1))
                .take(points.len())
            {
                if (a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y) {
                    let x = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                    crossings.push((x, if b[1] > a[1] { 1 } else { -1 }));
                }
            }
            crossings.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut winding = 0;
            let mut left = 0.0;
            for &(right, delta) in &crossings {
                if winding != 0 {
                    let start = (left + w as f64 / 2.0 - 0.5).ceil().max(0.0) as usize;
                    let end = ((right + w as f64 / 2.0 - 0.5).ceil().max(0.0) as usize).min(w);
                    for px in start.min(w)..end {
                        Self::blend_pixel(raster, (py * w + px) * 4, rgb, 1.0);
                    }
                }
                winding += delta;
                left = right;
            }
        }
    }
    /// An image stamp of `actor` into the colour-sensing raster.
    fn raster_stamp(&mut self, actor: usize) {
        if self.sprites[actor].text.is_some() {
            return;
        }
        let (l, r, b, t) = self.bounds(actor);
        let (w, h) = self.raster_size();
        let (hw, hh) = (w as f64 / 2.0, h as f64 / 2.0);
        let x0 = (l + hw).floor().max(0.0) as usize;
        let x1 = ((r + hw).ceil().max(0.0) as usize).min(w);
        let y0 = (hh - t).floor().max(0.0) as usize;
        let y1 = ((hh - b).ceil().max(0.0) as usize).min(h);
        let mut texels = vec![];
        for py in y0..y1 {
            for px in x0..x1 {
                let (x, y) = (px as f64 + 0.5 - hw, hh - py as f64 - 0.5);
                if let Some((rgb, alpha)) = self.color_at(actor, x, y) {
                    texels.push(((py * w + px) * 4, rgb, alpha));
                }
            }
        }
        if let Some(raster) = self.raster_mut() {
            for (at, rgb, alpha) in texels {
                Self::blend_pixel(raster, at, rgb, alpha);
            }
        }
    }
    /// The rendered stage colour at a point without `skip` (official
    /// color_match_texture_points renders the stage with the actor hidden).
    fn stage_color(&self, x: f64, y: f64, skip: usize, layers: &[usize]) -> [f64; 3] {
        let mut color = [255.0; 3];
        let over = |color: &mut [f64; 3], rgb: [f64; 3], alpha: f64| {
            for k in 0..3 {
                color[k] = rgb[k] * alpha + color[k] * (1.0 - alpha);
            }
        };
        let scene = &self.program.scenes[self.current_scene];
        let stage = &self.sprites[scene.stage];
        if let Some(costume) = stage
            .style
            .as_deref()
            .and_then(|id| self.program.costumes.get(id))
        {
            let u = x / self.program.width + 0.5;
            let v = 0.5 - y / self.program.height;
            if let Some(rgb) = self.costume_texel(costume, u, v) {
                over(&mut color, rgb, 1.0);
            }
        }
        let (w, h) = self.raster_size();
        let pen = self.pen_rasters[self.current_scene]
            .as_ref()
            .and_then(|raster| {
                let px = (x + w as f64 / 2.0).floor();
                let py = (h as f64 / 2.0 - y).floor();
                if px < 0.0 || py < 0.0 || px >= w as f64 || py >= h as f64 {
                    return None;
                }
                let at = (py as usize * w + px as usize) * 4;
                let p = &raster[at..at + 4];
                (p[3] > 0).then(|| {
                    (
                        [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])],
                        f64::from(p[3]) / 255.0,
                    )
                })
            });
        let layer = self.pen_layer.min(self.order.len());
        for (i, &sprite) in self.order.iter().enumerate() {
            if i == layer
                && let Some((rgb, alpha)) = pen
            {
                over(&mut color, rgb, alpha);
            }
            if sprite == skip || !layers.contains(&sprite) {
                continue;
            }
            if let Some((rgb, alpha)) = self.color_at(sprite, x, y) {
                over(&mut color, rgb, alpha);
            }
        }
        if layer >= self.order.len()
            && let Some((rgb, alpha)) = pen
        {
            over(&mut color, rgb, alpha);
        }
        color
    }
    /// bump_into_color: sample the actor's opaque costume cells (at most ~2000)
    /// and compare the stage beneath with the official 5/5/4-bit tolerance.
    fn touching_color(&self, actor: usize, color: u32) -> bool {
        let a = &self.sprites[actor];
        if !a.alive || !a.visible || a.stage {
            return false;
        }
        let Some(geometry) = self.geometry(actor) else {
            return false;
        };
        if geometry.width == 0.0 || geometry.height == 0.0 {
            return false;
        }
        let costume = geometry.costume;
        let target = [(color >> 16) as u8, (color >> 8) as u8, color as u8];
        let matches = |c: [f64; 3]| {
            let c = c.map(|v| v.round().clamp(0.0, 255.0) as u8);
            c[0] & 248 == target[0] & 248
                && c[1] & 248 == target[1] & 248
                && c[2] & 240 == target[2] & 240
        };
        // Only actors whose bounds meet ours can cover a sample point.
        let (l, r, b, t) = self.bounds(actor);
        let layers: Vec<usize> = self
            .order
            .iter()
            .copied()
            .filter(|&j| {
                if j == actor || !self.sprites[j].alive || !self.sprites[j].visible {
                    return false;
                }
                let (jl, jr, jb, jt) = self.bounds(j);
                jl <= r && jr >= l && jb <= t && jt >= b
            })
            .collect();
        let (mw, mh) = costume
            .mask
            .as_ref()
            .map_or((32, 32), |(mw, mh, _)| (*mw, *mh));
        let step = ((mw * mh) as f64 / 2000.0).sqrt().ceil().max(1.0) as usize;
        let (hw, hh) = (self.program.width / 2.0, self.program.height / 2.0);
        for cy in (0..mh).step_by(step) {
            for cx in (0..mw).step_by(step) {
                let (u, v) = ((cx as f64 + 0.5) / mw as f64, (cy as f64 + 0.5) / mh as f64);
                if let Some((_, _, bits)) = &costume.mask {
                    let cell = cy * mw + cx;
                    if bits
                        .get(cell / 8)
                        .is_none_or(|byte| byte >> (cell % 8) & 1 == 0)
                    {
                        continue;
                    }
                }
                let (x, y) = geometry.point(u, v);
                if x.abs() > hw || y.abs() > hh {
                    continue;
                }
                if matches(self.stage_color(x, y, actor, &layers)) {
                    return true;
                }
            }
        }
        false
    }
    /// Scratch-style bounce: reflect away from the nearest touched edge, move inside.
    fn bounce(&mut self, actor: usize) {
        let a = &self.sprites[actor];
        if ![a.x, a.y, a.direction, a.scale, a.size_x, a.size_y]
            .iter()
            .all(|n| n.is_finite())
        {
            return;
        }
        let (l, r, b, t) = self.bounds(actor);
        let (w, h) = (self.program.width / 2.0, self.program.height / 2.0);
        // Room left before each edge: left, top, right, bottom.
        let gaps = [l + w, h - t, w - r, b + h];
        let (edge, gap) = gaps
            .iter()
            .enumerate()
            .min_by(|x, y| x.1.total_cmp(y.1))
            .map(|(i, g)| (i, *g))
            .unwrap();
        if gap > 0.0 {
            return;
        }
        let a = &mut self.sprites[actor];
        let (mut dx, mut dy) = a.direction.to_radians().sin_cos();
        match edge {
            0 => dx = dx.abs(),
            1 => dy = -dy.abs(),
            2 => dx = -dx.abs(),
            _ => dy = dy.abs(),
        }
        a.direction = dx.atan2(dy).to_degrees();
        // A nonzero pivot moves the texture centre when reflection changes its
        // angle (or mirror sign). Push the *new* bounds inside. Keep the legacy
        // zero-pivot bounce correction unchanged.
        let (l, r, b, t) = if self
            .geometry(actor)
            .is_some_and(|g| g.costume.center_point != [0.0; 2])
        {
            self.bounds(actor)
        } else {
            (l, r, b, t)
        };
        let a = &mut self.sprites[actor];
        // Push back inside along every violated axis.
        if l < -w {
            a.x += -w - l;
        }
        if r > w {
            a.x -= r - w;
        }
        if b < -h {
            a.y += -h - b;
        }
        if t > h {
            a.y -= t - h;
        }
        self.dirty[actor] = true;
    }
    /// Scene by id, display name, or 1-based number in project order.
    fn find_scene(&self, value: &Cell) -> Option<usize> {
        let text = value.text();
        let scenes = &self.program.scenes;
        scenes
            .iter()
            .position(|s| s.id == text)
            .or_else(|| scenes.iter().position(|s| s.name == text))
            .or_else(|| match value {
                Cell::Number(n) if n.fract() == 0.0 && *n >= 1.0 => {
                    let i = *n as usize - 1;
                    (i < scenes.len()).then_some(i)
                }
                _ => None,
            })
    }
    /// K4 only finishes activation hats on exit; other scene-bound tasks suspend
    /// and clones/properties persist. KN retains its existing exit policy.
    /// This does not change scheduler order or the activation dispatch phase.
    fn switch_scene(&mut self, target: usize) {
        let old = self.current_scene;
        for task in 0..self.tasks.len() {
            if self.sprites[self.tasks[task].actor].scene == old
                && if self.program.semantics == RuntimeSemantics::Kitten4 {
                    matches!(
                        self.program.scripts.get(self.tasks[task].script),
                        Some(Script {
                            event: ScriptEvent::K4SceneActivate,
                            ..
                        })
                    )
                } else {
                    !self.tasks[task].global_start && !self.tasks[task].kn_when
                }
            {
                self.finish_task(task);
            }
        }
        for i in 0..self.sprites.len() {
            if self.program.semantics != RuntimeSemantics::Kitten4
                && self.sprites[i].alive
                && self.sprites[i].clone_index > 0
                && self.sprites[i].scene == old
            {
                self.delete_clone(i);
            }
        }
        // Pen output of this frame was for the old scene's surface.
        self.lines.clear();
        self.text_stamps.clear();
        self.pen_fills.clear();
        self.image_stamps.clear();
        self.clear = false;
        self.scene_orders[old] = std::mem::take(&mut self.order);
        self.order = self.scene_orders[target].clone();
        self.current_scene = target;
        self.order_dirty = true;
        self.scene_changed = true;
        self.transition = self.next_transition.clone();
        for i in 0..self.sprites.len() {
            if self.sprites[i].scene == target && self.sprites[i].alive {
                self.dirty[i] = true;
            }
        }
        let scene_id = self.program.scenes[target].id.clone();
        self.dispatch(|event| {
            matches!(event, ScriptEvent::Start | ScriptEvent::K4SceneActivate)
                || matches!(event, ScriptEvent::K4Backdrop(id) if id == &scene_id)
        });
    }
    /// Text effect (official module: textEffects). `Some(text)` sets the text;
    /// None re-renders after a size/colour change. Empty text keeps the costume.
    fn set_sprite_text(&mut self, actor: usize, text: Option<String>) {
        let a = &mut self.sprites[actor];
        let text = match text {
            Some(text) => Some(text),
            None => a.text.as_ref().map(|t| t.text.clone()),
        };
        let Some(text) = text.filter(|t| !t.is_empty()) else {
            return;
        };
        if a.text_scale.is_none() {
            a.text_scale = Some(a.scale);
        }
        a.scale = 100.0;
        a.text = Some(SpriteText {
            text,
            size: a.text_style.0,
            color: format!("#{:06x}", a.text_style.1 & 0xff_ffff),
        });
        self.dirty[actor] = true;
    }
    /// A costume change leaves text mode and restores the scale from before it.
    fn leave_text(&mut self, actor: usize) {
        let a = &mut self.sprites[actor];
        if a.text.take().is_some()
            && let Some(scale) = a.text_scale.take()
        {
            a.scale = scale;
        }
    }
    /// Official stage_animation timelines. None when the animation does not apply
    /// (appearing while visible, emphasis/disappear while hidden): no wait then.
    fn timeline(&mut self, actor: usize, op: Op) -> Option<Timeline> {
        let a = &self.sprites[actor];
        let (x, y, sx, sy, dir, alpha) = (a.x, a.y, a.size_x, a.size_y, a.direction, a.opacity);
        let none = NO_PROPS;
        let mut specs: Vec<(f64, Props, Props, Option<usize>)> = vec![];
        let mut tween = |d: f64, to: &[(usize, f64)]| specs.push((d, none, props(to), None));
        let (appear, kind, direction) = match op {
            Op::Emphasis(kind) => {
                if !a.visible {
                    return None;
                }
                match kind {
                    0 => {
                        for (d, deg) in [
                            (0.067, 4.0),
                            (0.083, -13.0),
                            (0.1, 6.0),
                            (0.083, -8.0),
                            (0.067, 2.0),
                            (0.05, 0.0),
                        ] {
                            tween(d, &[(TL_DIR, dir + deg)]);
                        }
                    }
                    1 => {
                        for (d, k) in [(0.3, 0.76), (0.2, 1.07), (0.2, 0.97), (0.15, 1.0)] {
                            tween(d, &[(TL_SX, sx * k), (TL_SY, sy * k)]);
                        }
                    }
                    _ => {
                        let (_, _, bottom, top) = self.bounds(actor);
                        let height = top - bottom;
                        tween(
                            0.1,
                            &[
                                (TL_SX, sx * 1.2),
                                (TL_SY, sy * 0.8),
                                (TL_Y, y - 0.1 * height),
                            ],
                        );
                        tween(0.083, &[(TL_SX, sx), (TL_SY, sy), (TL_Y, y)]);
                        for (d, dy) in [(0.25, 12.0), (0.25, 0.0), (0.15, 5.0), (0.15, 0.0)] {
                            tween(d, &[(TL_Y, y + dy)]);
                        }
                    }
                }
                return Some(Timeline::new(self.time, &specs));
            }
            Op::Transition(appear, kind, direction) => (appear, kind, direction),
            _ => return None,
        };
        if appear == a.visible {
            return None;
        }
        // Directions: 0 up, 1 down, 2 left, 3 right (stage y points up).
        let horizontal = direction >= 2;
        let left_down = if matches!(direction, 1 | 2) {
            -1.0
        } else {
            1.0
        };
        let left_up = if matches!(direction, 0 | 2) {
            -1.0
        } else {
            1.0
        };
        let along = |d: f64| if horizontal { (x + d, y) } else { (x, y + d) };
        let restore = [x, y, sx, sy, dir, alpha];
        let mut start_at: Option<(f64, f64)> = None;
        match kind {
            // slideIn
            0 => {
                start_at = Some(if horizontal {
                    (x + 200.0 * left_down, y)
                } else {
                    (x, y + 150.0 * left_down)
                });
                tween(0.15, &[(TL_X, x), (TL_Y, y), (TL_ALPHA, alpha)]);
                for (d, kx, ky) in [
                    (0.05, 1.2, 0.8),
                    (0.15, 0.9, 1.1),
                    (0.15, 1.06, 0.94),
                    (0.1, 1.0, 1.0),
                ] {
                    tween(d, &[(TL_SX, sx * kx), (TL_SY, sy * ky)]);
                }
            }
            // bounceIn
            1 => {
                start_at = Some(along(22.0 * left_down));
                let (bx, by) = along(-25.0 * left_down);
                tween(0.3, &[(TL_X, bx), (TL_Y, by), (TL_ALPHA, alpha)]);
                tween(0.2, &[(TL_X, x), (TL_Y, y)]);
                let (fx, fy) = along(-6.0 * left_down);
                tween(0.15, &[(TL_X, fx), (TL_Y, fy)]);
                tween(0.15, &[(TL_X, x), (TL_Y, y)]);
            }
            // flyIn
            2 => {
                start_at = Some(along(150.0 * left_down));
                specs.push((
                    0.4,
                    props(&[(TL_DIR, dir + 16.0 * left_up)]),
                    props(&[
                        (TL_X, x),
                        (TL_Y, y),
                        (TL_ALPHA, alpha),
                        (TL_DIR, dir - 6.0 * left_up),
                    ]),
                    None,
                ));
                for (d, deg) in [(0.2, 2.0), (0.15, -1.2), (0.15, 0.0)] {
                    specs.push((d, none, props(&[(TL_DIR, dir + deg * left_up)]), None));
                }
            }
            // slideOut
            3 => {
                let (from, to, exit) = if horizontal {
                    (
                        props(&[(TL_SX, sx * 1.3)]),
                        props(&[
                            (TL_SX, sx * 0.95),
                            (TL_SY, sy * 1.05),
                            (TL_X, x - 40.0 * left_up),
                        ]),
                        (x + 250.0 * left_up, y),
                    )
                } else if direction == 0 {
                    (
                        props(&[(TL_SX, sx * 0.7), (TL_SY, sy * 1.1)]),
                        props(&[
                            (TL_SX, sx * 1.1),
                            (TL_SY, sy * 0.7),
                            (TL_Y, y + 50.0 * left_up),
                        ]),
                        (x, y - 70.0 * left_up),
                    )
                } else {
                    (
                        props(&[(TL_SY, sy * 0.7)]),
                        props(&[
                            (TL_SX, sx * 0.97),
                            (TL_SY, sy * 1.03),
                            (TL_Y, y + 50.0 * left_up),
                        ]),
                        (x, y - 70.0 * left_up),
                    )
                };
                specs.push((0.2, from, to, None));
                specs.push((0.3, none, props(&[(TL_SX, sx), (TL_SY, sy)]), None));
                specs.push((0.3, none, props(&[(TL_X, exit.0), (TL_Y, exit.1)]), Some(2)));
                specs.push((0.3, none, props(&[(TL_ALPHA, 0.0)]), Some(2)));
            }
            // bounceOut
            4 => {
                let (ox, oy) = along(-35.0 * left_down);
                let (ux, uy) = along(45.0 * left_down);
                specs.push((0.3, none, props(&[(TL_X, ox), (TL_Y, oy)]), None));
                specs.push((0.4, none, props(&[(TL_X, ux), (TL_Y, uy)]), Some(1)));
                specs.push((0.4, none, props(&[(TL_ALPHA, 0.0)]), Some(1)));
            }
            // flyOut
            _ => {
                let (fx, fy) = along(150.0 * left_down);
                specs.push((0.15, none, props(&[(TL_DIR, dir + 10.0 * left_down)]), None));
                specs.push((
                    0.1,
                    none,
                    props(&[(TL_DIR, dir - 7.0 * left_down)]),
                    Some(1),
                ));
                specs.push((0.1, none, props(&[(TL_DIR, dir)]), None));
                specs.push((
                    0.3,
                    none,
                    props(&[(TL_ALPHA, 0.0), (TL_X, fx), (TL_Y, fy)]),
                    Some(1),
                ));
            }
        }
        let a = &mut self.sprites[actor];
        if appear {
            a.visible = true;
        }
        if let Some((px, py)) = start_at {
            a.opacity = 0.0;
            a.x = px;
            a.y = py;
        }
        let mut timeline = Timeline::new(self.time, &specs);
        timeline.restore = Some(restore);
        timeline.hide = !appear;
        Some(timeline)
    }
    /// Advances a task's timeline; true when it has finished.
    fn timeline_step(&mut self, index: usize, actor: usize) -> bool {
        let Some(mut timeline) = self.tasks[index].timeline.take() else {
            return true;
        };
        let elapsed = self.time - timeline.start;
        let old = (self.sprites[actor].x, self.sprites[actor].y);
        for tween in &mut timeline.tweens {
            if elapsed < tween.at {
                continue;
            }
            let sprite = &mut self.sprites[actor];
            if tween.begin[TL_ALPHA].is_nan() {
                for (i, v) in tween.from.iter().enumerate() {
                    if v.is_finite() {
                        set_prop(sprite, i, *v);
                    }
                }
                tween.begin = props_of(sprite);
            }
            let t = if tween.duration <= 0.0 {
                1.0
            } else {
                ((elapsed - tween.at) / tween.duration).clamp(0.0, 1.0)
            };
            let k = ease(t);
            for i in 0..6 {
                if tween.to[i].is_finite() {
                    set_prop(
                        sprite,
                        i,
                        tween.begin[i] + (tween.to[i] - tween.begin[i]) * k,
                    );
                }
            }
        }
        self.dirty[actor] = true;
        let finished = elapsed >= timeline.total();
        if finished {
            let sprite = &mut self.sprites[actor];
            if let Some(restore) = timeline.restore {
                for (i, v) in restore.iter().enumerate() {
                    set_prop(sprite, i, *v);
                }
            }
            if timeline.hide {
                sprite.visible = false;
            }
        } else {
            self.tasks[index].timeline = Some(timeline);
        }
        self.line(actor, old);
        finished
    }
    /// Sprites selected by a collision subject/target: one actor with its clones,
    /// or every live actor of a camp in the active scene.
    fn camp_members(&self, camp: u8) -> impl Iterator<Item = usize> + '_ {
        (0..self.sprites.len()).filter(move |&i| {
            let a = &self.sprites[i];
            a.alive && !a.stage && a.camp == camp && a.scene == self.current_scene
        })
    }
    /// on_bump_actor: compare each instance's contact with the previous check and
    /// fire start / move / end (official module 45161, once per runtime frame).
    fn check_bumps(&mut self) {
        if self.stopped || !self.has_bump_scripts {
            return;
        }
        let mut fire = vec![];
        for script in 0..self.program.scripts.len() {
            let ScriptEvent::Bump(target, kind) = self.program.scripts[script].event else {
                continue;
            };
            let owner = self.program.scripts[script].actor;
            if !self.in_active_scene(owner) {
                continue;
            }
            let origin = self.sprites[target].origin;
            for subject in self.instances(owner) {
                let hit = if self.sprites[subject].alive && self.sprites[subject].visible {
                    (0..self.sprites.len()).find(|&j| {
                        j != subject
                            && self.sprites[j].alive
                            && self.sprites[j].visible
                            && self.sprites[j].origin == origin
                            && self.overlap(subject, j)
                    })
                } else {
                    None
                };
                let key = (script, subject);
                let previous = self.bump_state.get(&key).copied().flatten();
                let phase = match (previous.is_some(), hit.is_some()) {
                    (false, true) => Some(0),
                    (true, true) => Some(1),
                    (true, false) => Some(2),
                    (false, false) => None,
                };
                if hit.is_some() || previous.is_some() {
                    self.bump_state.insert(key, hit);
                }
                if phase == Some(kind) {
                    fire.push((script, subject, hit.or(previous).unwrap_or(usize::MAX)));
                }
            }
        }
        for (script, subject, other) in fire {
            // An edge-triggered hat does not restart its own running script.
            let running = self
                .tasks
                .iter()
                .any(|t| !t.done && t.actor == subject && t.script == script);
            if running {
                continue;
            }
            if let Some(task) = self.spawn(script, subject) {
                self.tasks[task].bumped = other;
            }
        }
    }
    /// Shared inheritance hook for clone/split implementations. Never copy defaults:
    /// official UserVariableImpl.clone_entity_variables copies the live source table.
    fn copy_actor_variables(&self, source: usize) -> BTreeMap<usize, Cell> {
        self.sprites[source]
            .variables
            .iter()
            .map(|(&k, v)| (k, v.deep_clone()))
            .collect()
    }
    fn read_actor_variable(&mut self, actor: usize, slot: usize) -> Cell {
        if let Some(value) = self
            .sprites
            .get(actor)
            .filter(|s| s.alive)
            .and_then(|s| s.variables.get(&slot))
        {
            value.clone()
        } else {
            self.value_error = Some(format!(
                "entity_variable_operation_out_of_scope: {}",
                self.program.actor_variable_names[slot]
            ));
            Cell::Null
        }
    }
    fn write_actor_variable(&mut self, actor: usize, slot: usize, value: Cell) {
        if let Some(cell) = self
            .sprites
            .get_mut(actor)
            .filter(|s| s.alive)
            .and_then(|s| s.variables.get_mut(&slot))
        {
            *cell = value;
        } else {
            self.value_error = Some(format!(
                "entity_variable_operation_out_of_scope: {}",
                self.program.actor_variable_names[slot]
            ));
        }
    }
    fn clone_sprite(&mut self, source: usize, split: Option<(f64, f64)>) -> Result<()> {
        ensure!(!self.sprites[source].stage, "the stage cannot be cloned");
        ensure!(
            self.program.semantics != RuntimeSemantics::Kitten4
                || self.sprites[source].clone_index == 0,
            "Kitten 4 clone body cannot clone itself"
        );
        if !self.sprites[source].alive {
            return Ok(());
        }
        let origin = self.sprites[source].origin;
        let live = (0..self.sprites.len())
            .filter(|&i| self.sprites[i].alive && self.sprites[i].origin == origin && i != origin)
            .count();
        if self.program.semantics == RuntimeSemantics::Kitten4 {
            // Official iNFq clone_entity: per-entity, per-frame guard uses >300,
            // so the 301st creation succeeds. This is NOT a live clone cap.
            let count = self.clone_counts.entry(origin).or_default();
            if *count > 300 {
                return Ok(());
            }
            *count += 1;
        } else if live >= 300 {
            return Ok(());
        }
        // Official RuntimeDataImpl/clone_created evicts the oldest clone when
        // per_entity_clone_limit (512 in Kitten 4) is exceeded, not the newest.
        if self.program.semantics == RuntimeSemantics::Kitten4
            && live >= 512
            && let Some(oldest) = (0..self.sprites.len())
                .filter(|&i| {
                    self.sprites[i].alive && self.sprites[i].origin == origin && i != origin
                })
                .min_by_key(|&i| self.sprites[i].clone_index)
        {
            self.delete_clone(oldest);
        }
        self.clone_serial += 1;
        let mut sprite = self.sprites[source].clone();
        sprite.variables = self.copy_actor_variables(source);
        sprite.id = format!("{}#{}", self.sprites[origin].id, self.clone_serial);
        sprite.clone_index = live as u32 + 1;
        if self.program.semantics == RuntimeSemantics::Kitten4 {
            let order = self.clone_orders.entry(origin).or_default();
            *order += 1;
            sprite.clone_index = *order;
        }
        sprite.empty_code = self.program.semantics == RuntimeSemantics::Kitten4 && split.is_none();
        if let Some((x, y)) = split {
            sprite.x = if x.is_nan() { 0.0 } else { x };
            sprite.y = if y.is_nan() { 0.0 } else { y };
        }
        sprite.pen = false;
        sprite.fill_path = None;
        if split.is_some() {
            // Official clone-state.bcm: a fresh brush, not a copy of the source.
            sprite.size = 1.0;
            sprite.color = [0.0, 0.0, 0.0, 1.0];
            sprite.hsv = [0.0, 0.0, 0.0];
        }
        let index = if let Some(slot) = self.free_slots.pop() {
            self.sprites[slot] = sprite;
            slot
        } else {
            self.sprites.push(sprite);
            self.dirty.push(true);
            self.sprites.len() - 1
        };
        self.dirty[index] = true;
        if self.program.semantics == RuntimeSemantics::Kitten4 {
            self.clone_legacy_physics_body(source, index);
        }
        self.clones += 1;
        // A clone starts directly behind its source.
        let at = self.order.iter().position(|&i| i == source).unwrap_or(0);
        self.order.insert(at, index);
        if self.program.semantics == RuntimeSemantics::KnCurrent && at < self.pen_layer {
            self.pen_layer += 1;
        }
        self.order_dirty = true;
        for script in 0..self.program.scripts.len() {
            let event = &self.program.scripts[script].event;
            let starts = if split.is_some() {
                matches!(
                    event,
                    ScriptEvent::Start | ScriptEvent::K4GlobalStart | ScriptEvent::K4SceneActivate
                )
            } else {
                matches!(event, ScriptEvent::CloneStart)
            };
            if starts
                && self.program.scripts[script].actor == origin
                && let Some(task) = self.spawn(script, index)
                && self.program.semantics == RuntimeSemantics::KnCurrent
            {
                self.ready.push_back(task);
            }
        }
        Ok(())
    }
    fn delete_clone(&mut self, index: usize) {
        if !self.sprites[index].alive {
            return;
        }
        self.bump_state.retain(|&(_, actor), _| actor != index);
        self.remove_physics_body(index);
        for task in 0..self.tasks.len() {
            if self.tasks[task].actor == index {
                self.finish_task(task);
            }
        }
        let sprite = &mut self.sprites[index];
        sprite.alive = false;
        sprite.variables.clear();
        sprite.visible = false;
        self.removed.push(sprite.id.clone());
        if self.program.semantics == RuntimeSemantics::KnCurrent
            && self
                .order
                .iter()
                .position(|&i| i == index)
                .is_some_and(|at| at < self.pen_layer)
        {
            self.pen_layer -= 1;
        }
        self.order.retain(|&i| i != index);
        self.order_dirty = true;
        // Original indices are stable program references, never reusable slots.
        if self.sprites[index].clone_index > 0 {
            self.free_slots.push(index);
            self.clones -= 1;
        }
    }
    fn move_layer(&mut self, actor: usize, movement: LayerMove) {
        let Some(at) = self.order.iter().position(|&i| i == actor) else {
            return;
        };
        self.order.remove(at);
        let to = match movement {
            LayerMove::Front => self.order.len(),
            LayerMove::Back => 0,
            LayerMove::Forward => (at + 1).min(self.order.len()),
            LayerMove::Backward => at.saturating_sub(1),
            LayerMove::Relative(target, above) => self
                .order
                .iter()
                .position(|&i| i == target)
                .map_or(at, |t| t + usize::from(above)),
            LayerMove::By(by) => {
                let by = self.eval(by, actor);
                if by.is_finite() {
                    (at as f64 + by).clamp(0.0, self.order.len() as f64) as usize
                } else {
                    at
                }
            }
        };
        self.order.insert(to, actor);
        self.order_dirty = true;
    }
    fn random_unit(&mut self) -> f64 {
        self.random_state ^= self.random_state << 13;
        self.random_state ^= self.random_state >> 7;
        self.random_state ^= self.random_state << 17;
        (self.random_state >> 11) as f64 / ((1u64 << 53) as f64)
    }
    /// Stage point for an actor index, self (`usize::MAX`), mouse or random target.
    fn point(&mut self, target: usize, actor: usize) -> (f64, f64) {
        match target {
            TARGET_MOUSE => (self.mouse[0], self.mouse[1]),
            TARGET_RANDOM => {
                let x = (self.random_unit() - 0.5) * self.program.width;
                let y = (self.random_unit() - 0.5) * self.program.height;
                (x.round(), y.round())
            }
            usize::MAX => (self.sprites[actor].x, self.sprites[actor].y),
            t => (self.sprites[t].x, self.sprites[t].y),
        }
    }
    #[inline]
    fn global_value(&self, i: usize) -> Cell {
        match &self.values[i] {
            Some(value) => value.clone(),
            None => Cell::Number(self.slots[i]),
        }
    }
    #[inline]
    fn local_value(&self, i: usize) -> Cell {
        let t = &self.tasks[self.current_task];
        match &t.local_values[i] {
            Some(value) => value.clone(),
            None => Cell::Number(t.locals[i]),
        }
    }
    fn resolve_list(&mut self, list: ListRef) -> Option<List> {
        let value = match list {
            ListRef::Global(i) => return Some(self.lists[i as usize].clone()),
            ListRef::Local(i) => self.local_value(i as usize),
            ListRef::Variable(i) => self.global_value(i as usize),
            ListRef::Expression(i) => {
                self.eval_value(i as usize, self.tasks[self.current_task].actor)
            }
        };
        if let Cell::List(v) = value {
            Some(v)
        } else {
            if self.value_error.is_none() {
                self.value_error = Some(format!(
                    "list operation received a non-list value ({})",
                    value.text().chars().take(80).collect::<String>()
                ));
            }
            None
        }
    }
    #[inline(always)]
    fn eval_value(&mut self, i: usize, actor: usize) -> Cell {
        if self.program.deep_values.is_empty() {
            self.eval_value_one::<true>(i, actor)
        } else {
            self.eval_value_one::<false>(i, actor)
        }
    }
    fn eval_deep_value(&mut self, root: usize, actor: usize) -> Cell {
        // Each frame retains already evaluated operands until its parent runs.
        // A scoped queue (not a global memo) preserves duplicate evaluations,
        // order, reporter side effects and nested scheduler re-entry.
        let mut work = vec![((true, root), false)];
        let mut output = Vec::new();
        while let Some((key, exit)) = work.pop() {
            let children = self.evaluation_children(key);
            if !exit && !children.is_empty() {
                work.push((key, true));
                work.extend(children.into_iter().rev().map(|key| (key, false)));
                continue;
            }
            let mut cache: BTreeMap<_, VecDeque<_>> = BTreeMap::new();
            let start = output.len() - children.len();
            for (child, value) in children.into_iter().zip(output.drain(start..)) {
                cache.entry(child).or_default().push_back(value);
            }
            self.evaluation_cache.push(cache);
            let value = if key.0 {
                self.eval_value_one::<true>(key.1, actor)
            } else {
                Cell::Number(self.node_shallow(key.1, actor))
            };
            self.evaluation_cache.pop();
            output.push(value);
        }
        output.pop().unwrap()
    }
    fn node_shallow(&mut self, pc: usize, actor: usize) -> f64 {
        match self.program.expressions[pc] {
            ExprOp::Binary(op) => {
                let right = pc - 1;
                let left = self.program.expression_starts[right] as usize - 1;
                let a = self.operand(left, actor);
                let b = self.operand(right, actor);
                op.apply(a, b)
            }
            ExprOp::Unary(op) => {
                let a = self.operand(pc - 1, actor);
                op.apply(a)
            }
            _ => self.node_slow(pc, actor),
        }
    }
    fn evaluation_children(&self, key: (bool, usize)) -> Vec<(bool, usize)> {
        let mut children = Vec::new();
        if !key.0 {
            match self.program.expressions[key.1] {
                ExprOp::Binary(_) | ExprOp::Random => {
                    let right = key.1 - 1;
                    children.push((false, self.program.expression_starts[right] as usize - 1));
                    children.push((false, right));
                }
                ExprOp::Unary(_) | ExprOp::ListItem(_, false) => children.push((false, key.1 - 1)),
                ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => {
                    children.push((true, i))
                }
                _ => {}
            }
            match self.program.expressions[key.1] {
                ExprOp::ListItem(ListRef::Expression(i), _)
                | ExprOp::ListLength(ListRef::Expression(i)) => children.push((true, i as usize)),
                _ => {}
            }
            return children;
        }
        let expression = |e: Expr| (false, e.end as usize - 1);
        let list = |r: ListRef| match r {
            ListRef::Expression(i) => Some((true, i as usize)),
            _ => None,
        };
        match self.program.values[key.1] {
            ValueExpr::Number(e)
            | ValueExpr::CloneProperty(_, e, _)
            | ValueExpr::ActorVariable(_, _, Some(e)) => children.push(expression(e)),
            ValueExpr::Received(i)
            | ValueExpr::Whole(i)
            | ValueExpr::Calculate(i)
            | ValueExpr::Convert(i, _)
            | ValueExpr::Kitten4Convert(i, _)
            | ValueExpr::Not(i)
            | ValueExpr::Boolean(i)
            | ValueExpr::IsNumber(i, _)
            | ValueExpr::Encode64(i)
            | ValueExpr::Decode64(i)
            | ValueExpr::ParseFloat(i)
            | ValueExpr::K4Screen(i, _) => children.push((true, i)),
            ValueExpr::Contains(a, b)
            | ValueExpr::Kitten4Add(a, b)
            | ValueExpr::Split(a, b)
            | ValueExpr::ParseInt(a, b)
            | ValueExpr::Compare(a, b, _)
            | ValueExpr::Logic(a, b, _) => children.extend([(true, a), (true, b)]),
            ValueExpr::Ternary(c, a, b) => children.extend([(true, c), (true, a), (true, b)]),
            ValueExpr::List(r) => children.extend(list(r)),
            ValueExpr::Find(r, i, _) => {
                children.push((true, i));
                children.extend(list(r));
            }
            ValueExpr::Item(r, e) | ValueExpr::CloudItem(r, e) => {
                children.extend(e.map(expression));
                children.extend(list(r));
            }
            ValueExpr::Join(span) | ValueExpr::Temporary(span) => children.extend(
                (span.start..span.start + span.len)
                    .map(|i| (true, self.program.value_args[i as usize])),
            ),
            ValueExpr::Select(i, a, b) => {
                children.extend([(true, i), expression(a)]);
                if !self.program.single_text_selects.contains(&key.1) {
                    children.push(expression(b));
                }
            }
            _ => {}
        }
        children
    }
    fn eval_value_one<const PREPARED: bool>(&mut self, i: usize, actor: usize) -> Cell {
        // Keep dispatch and the ordinary evaluator in one function. The deep
        // walker specializes away this prelude after preparing its operands.
        if !PREPARED {
            if let Some(value) = self
                .evaluation_cache
                .last_mut()
                .and_then(|c| c.get_mut(&(true, i)))
                .and_then(VecDeque::pop_front)
            {
                return value;
            }
            if self.program.deep_values.contains(&i) {
                return self.eval_deep_value(i, actor);
            }
        }
        // Only strings/list references are cloned; numeric expressions stay unboxed.
        match self.program.values[i] {
            ValueExpr::Kitten4Add(a, b) => {
                // Offline player's math_arithmetic uses JS + whenever
                // either operand is not a number (see docs/kitten4-run-errors.md).
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                if matches!(a, Cell::Text(_) | Cell::List(_) | Cell::Costume(_))
                    || matches!(b, Cell::Text(_) | Cell::List(_) | Cell::Costume(_))
                {
                    Cell::Text(format!("{}{}", a.text(), b.text()).into())
                } else {
                    Cell::Number(a.number() + b.number())
                }
            }
            ValueExpr::Whole(input) => {
                let input = self.eval_value(input, actor);
                Cell::Bool(matches!(input,Cell::Number(n) if n==n.floor()))
            }
            ValueExpr::Calculate(input) => {
                let input = self.eval_value(input, actor);
                match input {
                    Cell::Text(text) => match calculate::evaluate(&text) {
                        Ok(value) => value,
                        Err(()) => {
                            self.value_error
                                .get_or_insert_with(|| "block_bad_math_expression".into());
                            Cell::Number(f64::NAN)
                        }
                    },
                    _ => {
                        // The official lexer iterates input.length: numbers do
                        // not get string-coerced and fail at postfix evaluation.
                        self.value_error
                            .get_or_insert_with(|| "block_bad_math_expression".into());
                        Cell::Number(f64::NAN)
                    }
                }
            }
            ValueExpr::Number(e) => Cell::Number(self.eval(e, actor)),
            ValueExpr::Constant(v) => self.program.constants[v].clone(),
            ValueExpr::Global(i) => self.global_value(i),
            ValueExpr::ActorVariable(target, slot, index) => {
                let target = if target == usize::MAX { actor } else { target };
                let target = if let Some(index) = index {
                    let origin = self.sprites[target].origin;
                    let wanted = self.eval(index, actor);
                    self.sprites.iter().position(|s| {
                        s.alive && s.origin == origin && f64::from(s.clone_index) == wanted
                    })
                } else {
                    Some(target)
                };
                if let Some(target) = target {
                    self.read_actor_variable(target, slot)
                } else {
                    if self.program.semantics == RuntimeSemantics::Kitten4 {
                        self.value_error = Some("clone_not_found".into());
                    }
                    Cell::Number(f64::NAN)
                }
            }
            ValueExpr::Local(i) => self.local_value(i),
            ValueExpr::Parameter(i) => self.tasks[self.current_task]
                .parameters
                .get(i)
                .cloned()
                .unwrap_or(Cell::Number(f64::NAN)),
            ValueExpr::Payload => self.tasks[self.current_task].payload.clone(),
            ValueExpr::Received(i) => {
                let message = self.eval_value(i, actor).text();
                Cell::Bool(self.received.contains(&message))
            }
            ValueExpr::Contains(a, b) => {
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                let valid = |v: &Cell| {
                    !matches!(v, Cell::Null) && !matches!(v, Cell::Number(n) if n.is_nan())
                };
                Cell::Bool(valid(&a) && valid(&b) && a.text().contains(&b.text()))
            }
            ValueExpr::Find(list, value, contains) => {
                let value = self.eval_value(value, actor);
                let index = self
                    .resolve_list(list)
                    .and_then(|list| list.borrow().iter().position(|v| v.equals(&value)));
                if contains {
                    Cell::Bool(index.is_some())
                } else {
                    Cell::Number(index.map_or(0.0, |i| (i + 1) as f64))
                }
            }
            ValueExpr::List(r) => self.resolve_list(r).map_or(Cell::Null, Cell::List),
            ValueExpr::CloudItem(r, e) => {
                let at = e.map(|e| self.eval(e, actor));
                self.resolve_list(r).map_or(Cell::Text("".into()), |v| {
                    let v = v.borrow();
                    let at = at.map_or_else(
                        || v.len().checked_sub(1),
                        |n| (n.is_finite() && n > 0.0).then(|| n.max(1.0).trunc() as usize - 1),
                    );
                    at.and_then(|i| v.get(i))
                        .cloned()
                        .unwrap_or(Cell::Text("".into()))
                })
            }
            ValueExpr::Ranking(show) => Cell::Bool(show == self.cloud.ranking.is_some()),
            ValueExpr::Item(r, e) => {
                let at = e.map(|e| self.eval(e, actor));
                if let Some(at) = at {
                    self.check_list_index(at);
                }
                self.resolve_list(r).map_or(Cell::Null, |v| {
                    let v = v.borrow();
                    let at = at.map_or_else(
                        || v.len().checked_sub(1),
                        |at| read_list_index(at, v.len(), self.program.semantics),
                    );
                    match at.and_then(|i| v.get(i)) {
                        Some(value) => value.clone(),
                        None => {
                            if self.program.semantics == RuntimeSemantics::Kitten4
                                && self.value_error.is_none()
                            {
                                self.value_error = Some(format!(
                                    "lists_get_value_bad_index (index {:?}, length {})",
                                    at.and_then(|i| i.checked_add(1)),
                                    v.len()
                                ));
                            }
                            Cell::Number(f64::NAN)
                        }
                    }
                })
            }
            ValueExpr::Temporary(parts) => {
                let mut items = Vec::with_capacity(parts.len as usize);
                for k in parts.start..parts.start + parts.len {
                    let part = self.program.value_args[k as usize];
                    items.push(self.eval_value(part, actor));
                }
                Cell::List(Rc::new(RefCell::new(items)))
            }
            ValueExpr::Split(text, separator) => {
                let text = self.eval_value(text, actor).text();
                let separator = self.eval_value(separator, actor).text();
                let parts = if separator.is_empty() {
                    text.encode_utf16()
                        .map(|unit| split_token(&String::from_utf16_lossy(&[unit])))
                        .collect()
                } else {
                    text.split(&separator).map(split_token).collect()
                };
                Cell::List(Rc::new(RefCell::new(parts)))
            }
            ValueExpr::Join(parts) => {
                let mut text = String::new();
                for k in parts.start..parts.start + parts.len {
                    let part = self.program.value_args[k as usize];
                    self.eval_value(part, actor).append_text_with_js_nonfinite(
                        &mut text,
                        self.program.semantics == RuntimeSemantics::KnCurrent,
                    );
                }
                Cell::Text(text.into())
            }
            ValueExpr::Convert(i, number) => {
                let v = self.eval_value(i, actor);
                if number {
                    let n = v.number();
                    // Official K4 Tn6a/convert_type and KN text_convert_to warn
                    // and return the original text when conversion fails.
                    if n.is_nan() && matches!(&v, Cell::Text(s) if s.as_ref() != "NaN") {
                        v
                    } else {
                        Cell::Number(n)
                    }
                } else {
                    Cell::Text(
                        v.text_with_js_nonfinite(
                            self.program.semantics == RuntimeSemantics::KnCurrent,
                        )
                        .into(),
                    )
                }
            }
            ValueExpr::Kitten4Convert(i, conversion) => {
                // Official kitten bundle: convert_type uses lodash.toNumber,
                // String and Boolean; failed numeric conversion returns String(i),
                // except the literal "NaN" and numeric NaN which remain NaN.
                let value = self.eval_value(i, actor);
                match conversion {
                    2 => Cell::Bool(value.truth()),
                    1 => Cell::Text(value.text_with_js_nonfinite(true).into()),
                    _ => {
                        let text = value.text_with_js_nonfinite(true);
                        let number = match &value {
                            Cell::List(_) | Cell::Text(_) => k4_number_text(&text),
                            _ => value.number(),
                        };
                        if number.is_nan() && text != "NaN" {
                            Cell::Text(text.into())
                        } else {
                            Cell::Number(number)
                        }
                    }
                }
            }
            ValueExpr::Not(i) => Cell::Bool(!self.eval_value(i, actor).truth()),
            ValueExpr::Boolean(i) => Cell::Bool(self.eval_value(i, actor).truth()),
            ValueExpr::IsNumber(i, finite) => Cell::Bool(
                matches!(self.eval_value(i, actor), Cell::Number(n) if if finite { n.is_finite() } else { n.is_nan() }),
            ),
            ValueExpr::Encode64(i) => {
                Cell::Text(kn_helpers::encode64(&self.eval_value(i, actor).text()).into())
            }
            ValueExpr::Decode64(i) => {
                Cell::Text(kn_helpers::decode64(&self.eval_value(i, actor).text()).into())
            }
            ValueExpr::ParseFloat(i) => {
                Cell::Number(kn_helpers::parse_float(&self.eval_value(i, actor).text()))
            }
            ValueExpr::ParseInt(i, radix) => {
                let text = self.eval_value(i, actor).text();
                let radix = self.eval_value(radix, actor).number();
                Cell::Number(kn_helpers::parse_int(&text, radix))
            }
            ValueExpr::Logic(a, b, and) => {
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                if a.truth() == and { b } else { a }
            }
            ValueExpr::Ternary(c, a, b) => {
                let c = self.eval_value(c, actor).truth();
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                if c { a } else { b }
            }
            ValueExpr::Select(text_index, start, end) => {
                let single = self.program.single_text_selects.contains(&i);
                let text = self.eval_value(text_index, actor).text();
                let start = self.eval(start, actor);
                let units = text.encode_utf16().collect::<Vec<_>>();
                if single {
                    let index = start.floor();
                    let selected =
                        if index.is_finite() && index >= 1.0 && index <= units.len() as f64 {
                            &units[index as usize - 1..index as usize]
                        } else {
                            &[]
                        };
                    return match String::from_utf16(selected) {
                        Ok(text) => Cell::Text(text.into()),
                        Err(_) => {
                            // Rc<str> cannot preserve JS lone surrogate code
                            // units. Fail explicitly instead of substituting U+FFFD.
                            self.value_error = Some("KN text_select produced an isolated UTF-16 surrogate; the current string model cannot preserve it".into());
                            Cell::Null
                        }
                    };
                }
                let end = self.eval(end, actor);
                let (start, end) = (start.floor(), end.floor());
                let clamp = |n: f64| (n.max(0.0) as usize).min(units.len());
                let selected = if start <= end - 1.0 {
                    units[clamp(start - 1.0)..clamp(end)].to_vec()
                } else {
                    // JS slice returns an empty array when the normalized end
                    // precedes the start (not a Rust slice-range panic on NaN).
                    let lo = clamp(end - 1.0);
                    let hi = clamp(start).max(lo);
                    units[lo..hi].iter().rev().copied().collect()
                };
                if self.program.semantics == RuntimeSemantics::KnCurrent {
                    match String::from_utf16(&selected) {
                        Ok(text) => Cell::Text(text.into()),
                        Err(_) => {
                            self.value_error = Some("KN text_select produced an isolated UTF-16 surrogate; the current string model cannot preserve it".into());
                            Cell::Null
                        }
                    }
                } else {
                    Cell::Text(String::from_utf16_lossy(&selected).into())
                }
            }
            ValueExpr::CallReturn(procedure, args) => self.call_reporter(procedure, args, actor),
            ValueExpr::K4Screen(value, stay) => {
                let value = self.eval_value(value, actor);
                Cell::Bool(stay == (self.find_scene(&value) == Some(self.current_scene)))
            }
            ValueExpr::CostumeName(target) => {
                let target = if target == usize::MAX { actor } else { target };
                let id = self.sprites[target].style.as_deref().unwrap_or("");
                Cell::Text(
                    self.program
                        .style_names
                        .get(id)
                        .map_or(id, String::as_str)
                        .into(),
                )
            }
            ValueExpr::CostumeLiteral(id) => {
                Cell::Costume(self.program.strings[id].as_str().into())
            }
            ValueExpr::CloneProperty(target, index, attribute) => {
                let origin = self.sprites[if target == usize::MAX { actor } else { target }].origin;
                let wanted = self.eval(index, actor);
                let found = (0..self.sprites.len()).find(|&i| {
                    let a = &self.sprites[i];
                    a.alive && a.origin == origin && f64::from(a.clone_index) == wanted
                });
                match found {
                    None => Cell::Number(f64::NAN),
                    Some(i) => {
                        let a = &self.sprites[i];
                        match attribute {
                            0 | 1 => {
                                let coordinate = if attribute == 0 { a.x } else { a.y };
                                Cell::Number(
                                    if self.program.semantics == RuntimeSemantics::Kitten4 {
                                        k4_round(coordinate)
                                    } else {
                                        coordinate
                                    },
                                )
                            }
                            2 => Cell::Number(
                                a.styles
                                    .iter()
                                    .position(|id| Some(id) == a.style.as_ref())
                                    .map_or(0.0, |i| (i + 1) as f64),
                            ),
                            3 => Cell::Number(k4_round(
                                180.0 - (a.direction + 90.0).rem_euclid(360.0),
                            )),
                            5 | 16 => Cell::Number(k4_round(a.scale * a.size_x / 100.0)),
                            17 => Cell::Number(k4_round(a.scale * a.size_y / 100.0)),
                            8 => Cell::Number(if a.visible {
                                (1.0 - a.opacity) * 100.0
                            } else {
                                100.0
                            }),
                            9 => Cell::Number(a.effects[2] + 100.0),
                            7 | 10..=13 => Cell::Number(a.effects[(attribute - 7) as usize]),
                            _ => {
                                let id = a.style.as_deref().unwrap_or("");
                                let name =
                                    self.program.style_names.get(id).map_or(id, String::as_str);
                                Cell::Text(name.into())
                            }
                        }
                    }
                }
            }
            ValueExpr::BumpProperty(attribute) => {
                let other = self.tasks[self.current_task].bumped;
                match self.sprites.get(other).filter(|a| a.alive) {
                    None => Cell::Number(f64::NAN),
                    Some(a) => Cell::Number(match attribute {
                        0 => a.x,
                        1 => a.y,
                        2 => a
                            .styles
                            .iter()
                            .position(|id| Some(id) == a.style.as_ref())
                            .map_or(0.0, |i| (i + 1) as f64),
                        3 => f64::from(a.camp),
                        4 => f64::from(a.clone_index),
                        5..=7 => a.scale,
                        8 => a.direction,
                        n => {
                            let scope = (n - 10) as usize;
                            if scope == 1 {
                                (1.0 - a.opacity) * 100.0
                            } else {
                                a.effects[scope]
                            }
                        }
                    }),
                }
            }
            ValueExpr::Answer => self.answer.clone(),
            ValueExpr::SceneId => {
                Cell::Text(self.program.scenes[self.current_scene].id.as_str().into())
            }
            ValueExpr::Choice(index) => {
                if index {
                    Cell::Number(self.choice.0)
                } else {
                    self.choice.1.clone()
                }
            }
            ValueExpr::WeekText => {
                const DAYS: [&str; 7] = [
                    "星期日",
                    "星期一",
                    "星期二",
                    "星期三",
                    "星期四",
                    "星期五",
                    "星期六",
                ];
                Cell::Text(DAYS[local_time(self.tz_offset_min)[4] as usize].into())
            }
            ValueExpr::Compare(a, b, op) => {
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                let result = match op {
                    Binary::Eq => a.equals(&b),
                    Binary::Ne => !a.equals(&b),
                    _ => {
                        if let (Cell::Text(a), Cell::Text(b)) = (&a, &b) {
                            match op {
                                Binary::Lt => a < b,
                                Binary::Le => a <= b,
                                Binary::Gt => a > b,
                                Binary::Ge => a >= b,
                                _ => false,
                            }
                        } else {
                            truth(op.apply(a.number(), b.number()))
                        }
                    }
                };
                Cell::Bool(result)
            }
        }
    }
    fn assign(&mut self, target: Target, value: Cell) {
        let (number, dynamic) = match target {
            Target::Global(i) => (&mut self.slots[i], &mut self.values[i]),
            Target::Local(i) => {
                let t = &mut self.tasks[self.current_task];
                (&mut t.locals[i], &mut t.local_values[i])
            }
        };
        *number = value.number();
        *dynamic = if matches!(value, Cell::Number(_)) {
            None
        } else {
            Some(value)
        };
    }
    fn check_list_index(&mut self, at: f64) {
        // Official K4 Tn6a/lists_get_value throws invaild_list_index;
        // KN list_item instead warns and returns NaN (official fixture evidence).
        if self.program.semantics == RuntimeSemantics::Kitten4 && !at.is_finite() {
            self.value_error = Some("invalid non-finite list index".into());
        }
    }
    fn eval_text(&mut self, text: usize, actor: usize) -> String {
        let mut value = String::new();
        for i in 0..self.program.texts[text].len() {
            match self.program.texts[text][i] {
                TextPart::Literal(index) => value.push_str(&self.program.strings[index]),
                TextPart::Value(i) => self.eval_value(i, actor).append_text_with_js_nonfinite(
                    &mut value,
                    self.program.semantics == RuntimeSemantics::KnCurrent,
                ),
            }
        }
        value
    }
    fn line(&mut self, actor: usize, old: (f64, f64)) {
        let a = &mut self.sprites[actor];
        // Official a1xw/Rt records position changes independently of pen down.
        if let Some(path) = &mut a.fill_path {
            if ![a.x, a.y].iter().all(|v| v.is_finite() && v.abs() <= 1e9) {
                self.value_error = Some("invalid pen path position".into());
            } else if path.last() == Some(&[a.x, a.y]) {
                // Consecutive duplicate points do not change a filled contour.
            } else if path.len() < 65536 {
                path.push([a.x, a.y]);
            } else {
                self.value_error = Some("pen path exceeds 65536 points".into());
            }
        }
        let a = &self.sprites[actor];
        if a.pen
            && [old.0, old.1, a.x, a.y, a.size]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1e9)
        {
            self.lines.extend_from_slice(&[
                old.0 as f32,
                old.1 as f32,
                a.x as f32,
                a.y as f32,
                a.size as f32,
                a.color[0],
                a.color[1],
                a.color[2],
                a.color[3],
            ]);
            if self.program.uses_color {
                let (to, size, color) = ((a.x, a.y), a.size, a.color);
                self.raster_line(old, to, size, color);
            }
        }
    }
    /// Bounded frame work. Round-robin cursor prevents a long warp script starving
    /// later actors. Clock sampled every 256 instructions, not on every block.
    pub fn advance(&mut self, dt: f64, max_instructions: usize, budget: Duration) -> Result<Frame> {
        self.advance_with(dt, max_instructions, budget, 1)
    }
    /// Like `advance`, but when a tick ends with no visible change (no pen output,
    /// clear, stamp, sprite or layer change) and nothing hit the budget, immediately
    /// runs up to `max_ticks - 1` more ticks in the same frame with dt = 0. Waits on
    /// time never complete early; loops that only update variables run more often.
    /// This is an opt-in player setting, not the official one-tick-per-frame rule.
    pub fn advance_with(
        &mut self,
        dt: f64,
        max_instructions: usize,
        budget: Duration,
        max_ticks: usize,
    ) -> Result<Frame> {
        ensure!(dt.is_finite(), "frame delta must be finite");
        self.sequence += 1;
        let started = Instant::now();
        let mut count = 0;
        let mut ticks = 0;
        let mut exceeded;
        let mut dt = dt.clamp(0.0, 0.25);
        loop {
            let layer = self.pen_layer;
            exceeded = self.tick(dt, max_instructions, budget, started, &mut count)?;
            ticks += 1;
            dt = 0.0;
            let visible = !self.lines.is_empty()
                || !self.text_stamps.is_empty()
                || !self.pen_fills.is_empty()
                || self.clear
                || self.reset
                || self.pen_layer != layer
                || self.order_dirty
                || self.scene_changed
                || !self.image_stamps.is_empty()
                || !self.removed.is_empty()
                || self.dirty.iter().any(|d| *d);
            let runnable = self.tasks.iter().any(|t| self.task_runnable(t));
            if exceeded
                || visible
                || !runnable
                || ticks >= max_ticks.max(1)
                || started.elapsed() >= budget
            {
                break;
            }
        }
        let execute_us = started.elapsed().as_micros();
        let scene = self.current_scene;
        let costume_turn = self.program.costume_turn;
        // Only the active scene is drawn; other scenes keep their dirty marks.
        let sprites = self
            .sprites
            .iter()
            .zip(&mut self.dirty)
            .filter_map(|(a, dirty)| {
                if !*dirty || (a.scene != scene && a.alive) {
                    return None;
                }
                *dirty = false;
                a.alive.then(|| {
                    let mut drawn = a.clone();
                    drawn.direction -= costume_turn;
                    // JSON maps nonfinite numbers to null. Hide invalid geometry
                    // on the wire, without changing the VM's logical state.
                    if ![a.x, a.y, a.direction, a.scale, a.size_x, a.size_y]
                        .iter()
                        .all(|n| n.is_finite())
                    {
                        drawn.visible = false;
                    }
                    if a.flip_x {
                        drawn.size_x = -drawn.size_x;
                    }
                    if a.flip_y {
                        drawn.size_y = -drawn.size_y;
                    }
                    drawn
                })
            })
            .collect();
        self.flush_cloud()?;
        Ok(Frame {
            sequence: self.sequence,
            reset: std::mem::take(&mut self.reset),
            sprites,
            variables: self.slots.clone(),
            timer: self.timer,
            timer_visible: self.timer_visible,
            pen_layer: self.pen_layer,
            lines: std::mem::take(&mut self.lines),
            text_stamps: std::mem::take(&mut self.text_stamps),
            pen_fills: std::mem::take(&mut self.pen_fills),
            logs: std::mem::take(&mut self.logs),
            audio_commands: std::mem::take(&mut self.audio_commands),
            order: std::mem::take(&mut self.order_dirty).then(|| {
                self.order
                    .iter()
                    .map(|&i| self.sprites[i].id.clone())
                    .collect()
            }),
            removed: std::mem::take(&mut self.removed),
            scene: self.program.scenes[scene].id.clone(),
            transition: self.transition.take(),
            scene_changed: std::mem::take(&mut self.scene_changed),
            ask: self.asks.front().cloned(),
            image_stamps: std::mem::take(&mut self.image_stamps),
            monitors: self.monitor_values(),
            clear: std::mem::take(&mut self.clear),
            active: self.active_tasks(),
            instructions: count,
            ticks,
            execute_us,
            budget_yield: exceeded,
        })
    }
    fn warp_iteration_yields(&mut self) -> bool {
        if self.program.semantics != RuntimeSemantics::Kitten4 || self.reporter_depth != 0 {
            return false;
        }
        // Lcae/OptiRunner.step_iteration_yield tests > before incrementing.
        let yielding = self.warp_iterations > 10_000;
        self.warp_iterations += 1;
        yielding
    }

    /// Executes one instruction of task `index`. Returns false when the task yields
    /// (or finishes) for this tick.
    #[inline(always)]
    fn exec(&mut self, index: usize, pc: usize, op: Op, actor: usize) -> Result<bool> {
        let moves = matches!(
            op,
            Op::Move(_)
                | Op::Position(_, _)
                | Op::X(_)
                | Op::Y(_)
                | Op::AddX(_)
                | Op::AddY(_)
                | Op::Pen(true)
                | Op::MoveToTarget(_)
                | Op::RotateAround(_, _)
        );
        let old = if moves {
            (self.sprites[actor].x, self.sprites[actor].y)
        } else {
            (0.0, 0.0)
        };
        if (moves && !matches!(op, Op::Pen(_)))
            || matches!(
                op,
                Op::Turn(_)
                    | Op::Direction(_)
                    | Op::Scale(_)
                    | Op::Visible(_)
                    | Op::Style(_)
                    | Op::NextStyle(_)
                    | Op::Opacity(_)
                    | Op::Effect(..)
                    | Op::ClearEffects
                    | Op::ChangeScale(_)
                    | Op::SizeAxis(..)
                    | Op::RotationType(_)
                    | Op::Flip(_)
                    | Op::FaceTo(_)
            )
        {
            self.dirty[actor] = true;
        }
        match op {
            Op::Kitten4Change(target, value, decrease) => {
                // Tn6a/change_variable evaluates n first, then f(previous,n,op).
                let value = self.eval_value(value, actor);
                let previous = match target {
                    Target::Global(i) => self.values[i]
                        .clone()
                        .unwrap_or(Cell::Number(self.slots[i])),
                    Target::Local(i) => self.tasks[index].local_values[i]
                        .clone()
                        .unwrap_or(Cell::Number(self.tasks[index].locals[i])),
                };
                if !matches!(previous, Cell::List(_) | Cell::Costume(_) | Cell::Null) {
                    let result = if !decrease
                        && (matches!(previous, Cell::Text(_))
                            || matches!(value, Cell::Text(_) | Cell::List(_) | Cell::Costume(_)))
                    {
                        Cell::Text(format!("{}{}", previous.text(), value.text()).into())
                    } else {
                        Cell::Number(if decrease {
                            previous.number() - value.number()
                        } else {
                            previous.number() + value.number()
                        })
                    };
                    self.assign(target, result);
                }
            }
            Op::WarpIteration => {
                if self.warp_iteration_yields() {
                    return Ok(false);
                }
            }
            Op::CloudSet(binding, value, change, decrease) => {
                let value = self.eval_value(value, actor);
                self.cloud_set(binding, value, change, decrease);
            }
            Op::CloudList(binding, action, at, value) => {
                let at = at.map(|e| self.eval(e, actor));
                let value = value.map(|v| self.eval_value(v, actor));
                self.cloud_list(binding, action, at, value);
            }
            Op::Ranking(binding, show) => {
                if !show || (binding.is_some() && self.cloud.ranking.is_none()) {
                    self.cloud.ranking = binding;
                }
            }
            Op::LegacyPhysics(command, value) => {
                let value = self.eval_value(value, actor);
                let number = if matches!(command, physics::Command::LegacyMass) {
                    match value {
                        Cell::Number(n) => n,
                        _ => f64::NAN,
                    }
                } else {
                    value.number()
                };
                self.physics_command(actor, command, [number, 0.0, 0.0])?;
            }
            Op::PhysicsVelocity(value, dir) => {
                let number = |v| match v {
                    Cell::Number(n) => n,
                    _ => f64::NAN,
                };
                let values = [
                    number(self.eval_value(value, actor)),
                    number(self.eval_value(dir, actor)),
                    0.0,
                ];
                self.physics_command(actor, physics::Command::LegacyVelocity, values)?;
            }
            Op::Physics(command, a, dir, time) => {
                let values = [
                    self.eval(a, actor),
                    self.eval(dir, actor),
                    self.eval(time, actor),
                ];
                let duration = self.physics_command(actor, command, values)?;
                if let Some(duration) = duration {
                    self.tasks[index].wake = self.time + duration;
                    return Ok(false);
                }
            }
            Op::SetActorVariable(slot, value) => {
                let value = self.eval_value(value, actor);
                self.write_actor_variable(actor, slot, value);
            }
            Op::ChangeActorVariable(slot, expr, sign) => {
                let previous = self.read_actor_variable(actor, slot).number();
                let value = previous + self.eval(expr, actor) * sign;
                self.write_actor_variable(actor, slot, Cell::Number(value));
            }
            Op::Set(s, e) => {
                let value = self.eval(e, actor);
                self.assign(Target::Global(s), Cell::Number(value));
            }
            Op::AssignLocal(s, value, op) => {
                let current = self.local_value(s);
                let current = if current.truth() {
                    current.number()
                } else {
                    0.0
                };
                let value = value.map_or(1.0, |v| self.eval_value(v, actor).number());
                // JS remainder keeps NaN for a zero divisor (unlike legacy Mod).
                // Official main.8ccf2442.js math_div_assign explicitly returns
                // NaN for a zero divisor; HateNeko's raw IEEE division differs.
                let result = if matches!(op, Binary::Div) && value == 0.0 {
                    f64::NAN
                } else if matches!(op, Binary::Mod) {
                    current % value
                } else {
                    op.apply(current, value)
                };
                self.tasks[self.current_task].locals[s] = result;
                self.tasks[self.current_task].local_values[s] = None;
            }
            Op::Change(s, e, sign) => {
                let value = self.global_value(s).number() + self.eval(e, actor) * sign;
                self.assign(Target::Global(s), Cell::Number(value));
            }
            Op::SetLocal(s, e) => {
                self.tasks[index].locals[s] = self.eval(e, actor);
                self.tasks[index].local_values[s] = None;
            }
            Op::ChangeLocal(s, e, sign) => {
                self.tasks[index].locals[s] += self.eval(e, actor) * sign;
                self.tasks[index].local_values[s] = None;
            }
            Op::SetValue(target, v) => {
                let value = self.eval_value(v, actor);
                self.assign(target, value);
            }
            Op::Move(e) => {
                let n = self.eval(e, actor);
                if !n.is_finite() {
                    return Ok(true);
                }
                let a = &mut self.sprites[actor];
                let (sin, cos) = a.direction.to_radians().sin_cos();
                a.x += n * sin;
                a.y += n * cos;
                self.line(actor, old);
            }
            Op::Position(x, y) => {
                let x = self.eval(x, actor);
                let y = self.eval(y, actor);
                // Official K4 Tn6a/z/c ignores each nonfinite axis independently.
                if x.is_finite() {
                    self.sprites[actor].x = x;
                }
                if y.is_finite() {
                    self.sprites[actor].y = y;
                }
                self.line(actor, old);
            }
            Op::X(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].x = value;
                }
                self.line(actor, old);
            }
            Op::Y(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].y = value;
                }
                self.line(actor, old);
            }
            Op::AddX(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].x += value;
                }
                self.line(actor, old);
            }
            Op::AddY(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].y += value;
                }
                self.line(actor, old);
            }
            Op::Turn(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].direction += value;
                }
            }
            Op::Direction(e) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].direction = value;
                }
            }
            Op::Scale(e) => {
                let value = self.eval(e, actor);
                let a = &mut self.sprites[actor];
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    if value.is_finite() {
                        a.scale = value.max(0.0);
                        a.size_x = 100.0;
                        a.size_y = 100.0;
                    }
                } else if value.is_finite()
                    || (value.is_nan() && self.program.semantics == RuntimeSemantics::KnCurrent)
                {
                    // Official KN keeps a NaN size but ignores ±Infinity (docs/nonfinite.md).
                    a.scale = value;
                }
            }
            Op::Visible(v) => self.sprites[actor].visible = v,
            Op::Style(value) => {
                let value = self.eval_value(value, actor);
                let styles = &self.sprites[actor].styles;
                let k4 = self.program.semantics == RuntimeSemantics::Kitten4;
                let missing_uuid = matches!(&value, Cell::Costume(id) if {
                    let parts: Vec<_> = id.split('-').collect();
                    parts.len() == 5 && parts.iter().zip([8,4,4,4,12]).all(|(s,n)| s.len() == n && s.bytes().all(|b| b.is_ascii_alphanumeric()))
                });
                let selected = match value {
                    Cell::Text(name) if k4 => styles.iter().find(|id| {
                        self.program
                            .style_names
                            .get(*id)
                            .is_some_and(|n| n == name.trim())
                    }),
                    Cell::Text(id) | Cell::Costume(id) => {
                        styles.iter().find(|s| s.as_str() == id.as_ref())
                    }
                    Cell::Number(n) if k4 && n.is_finite() && !styles.is_empty() => {
                        // Official Tn6a p(): round(index-1), then wrap, including negatives.
                        let index = (n - 0.5).floor().rem_euclid(styles.len() as f64) as usize;
                        styles.get(index)
                    }
                    Cell::Number(n) if n.is_finite() && (n + 0.5).floor() >= 1.0 => {
                        styles.get(((n + 0.5).floor() - 1.0) as usize)
                    }
                    _ => None,
                }
                .cloned();
                if let Some(selected) = selected {
                    self.leave_text(actor);
                    self.sprites[actor].style = Some(selected);
                } else if !k4 || missing_uuid {
                    bail!(
                        "invalid costume for {} at block {}",
                        self.sprites[actor].id,
                        self.program.sources[pc]
                    );
                }
                // Official Tn6a ignores missing names/non-finite indices. Missing
                // UUID objects still error in the editor (player may ignore them).
            }
            Op::NextStyle(next) => {
                self.leave_text(actor);
                let sprite = &mut self.sprites[actor];
                if !sprite.styles.is_empty() {
                    let current = sprite
                        .styles
                        .iter()
                        .position(|id| Some(id) == sprite.style.as_ref())
                        .unwrap_or(0);
                    let offset = if next { 1 } else { sprite.styles.len() - 1 };
                    sprite.style =
                        Some(sprite.styles[(current + offset) % sprite.styles.len()].clone());
                }
            }
            Op::Opacity(value) => {
                let transparency = self.eval(value, actor);
                if transparency.is_finite() {
                    self.sprites[actor].opacity = 1.0 - transparency.clamp(0.0, 100.0) / 100.0;
                }
            }
            Op::PenLayer(layer) => {
                if !self.sprites[actor].stage {
                    let count = self.order.len();
                    self.pen_layer = match layer {
                        PenLayer::Top => count,
                        PenLayer::Bottom => 0,
                        PenLayer::Forward => (self.pen_layer + 1).min(count),
                        PenLayer::Backward => self.pen_layer.saturating_sub(1),
                        PenLayer::Relative(index, above) => index + usize::from(above),
                    };
                }
            }
            Op::Pen(down) => {
                let was = self.sprites[actor].pen;
                self.sprites[actor].pen = down;
                if down && !was {
                    self.line(actor, old);
                }
            }
            Op::FillColor(color) => {
                ensure!(!self.sprites[actor].stage, "fill color requires an actor");
                self.sprites[actor].fill_color = Some(color);
            }
            Op::PenPath(begin) => {
                let a = &mut self.sprites[actor];
                ensure!(!a.stage, "pen path requires an actor");
                if begin {
                    ensure!(
                        [a.x, a.y].iter().all(|v| v.is_finite() && v.abs() <= 1e9),
                        "invalid pen path start"
                    );
                    a.fill_path = Some(vec![[a.x, a.y]]);
                } else if let Some(points) = a.fill_path.take()
                    && points.len() >= 3
                {
                    // Official Rt.draw_fill_pattern uses Canvas nonzero fill, current
                    // fill/stroke RGB at the end, and does not apply brush alpha.
                    let mut color = a.fill_color.unwrap_or(a.color);
                    color[3] = 1.0;
                    if self.program.uses_color {
                        self.raster_fill(&points, color);
                    }
                    self.pen_fills.push(PenFill {
                        before_line: self.lines.len() / 9,
                        before_text: self.text_stamps.len(),
                        before_image: self.image_stamps.len(),
                        points,
                        color,
                    });
                }
            }
            Op::Color(mut color) => {
                color[3] = self.sprites[actor].color[3];
                self.sprites[actor].color = color;
                self.sprites[actor].hsv = rgb_to_hsv(color);
            }
            Op::PenProperty(property, e, change) => {
                let value = self.eval(e, actor);
                if value.is_finite() {
                    self.sprites[actor].set_pen_property(property, value, change);
                }
            }
            Op::Timer(state) => match state {
                TimerState::Start => self.timer_running = true,
                TimerState::Stop => self.timer_running = false,
                TimerState::Reset => {
                    self.timer = 0.0;
                    self.timer_running = true;
                }
            },
            Op::TimerVisible(visible) => self.timer_visible = visible,
            Op::ClearList(list) => {
                if let Some(list) = self.resolve_list(list) {
                    list.borrow_mut().clear();
                }
            }
            Op::AppendList(list, e) => {
                let value = self.eval_value(e, actor);
                if let Some(list) = self.resolve_list(list) {
                    ensure!(
                        !contains_list(&value, &list),
                        "cyclic list at {}",
                        self.program.sources[pc]
                    );
                    list.borrow_mut().push(value);
                }
            }
            Op::DeleteList(list, e) => {
                let at = e.map(|e| self.eval(e, actor));
                if let Some(list) = self.resolve_list(list) {
                    let mut list = list.borrow_mut();
                    let at = at.map_or_else(
                        || list.len().checked_sub(1),
                        |at| {
                            if self.program.semantics == RuntimeSemantics::Kitten4 {
                                k4_splice_index(at, list.len(), false)
                            } else {
                                list_index(at)
                            }
                        },
                    );
                    if let Some(at) = at.filter(|i| *i < list.len()) {
                        list.remove(at);
                    }
                }
            }
            Op::InsertList(list, e, value) => {
                let value_index = self.eval(e, actor);
                let value = self.eval_value(value, actor);
                if let Some(list) = self.resolve_list(list) {
                    ensure!(
                        !contains_list(&value, &list),
                        "cyclic list at {}",
                        self.program.sources[pc]
                    );
                    let mut list = list.borrow_mut();
                    let at = if self.program.semantics == RuntimeSemantics::Kitten4 {
                        if value_index <= -1.0 && value_index > -2.0 {
                            Some(list.len())
                        } else {
                            k4_splice_index(value_index, list.len(), true)
                        }
                    } else {
                        list_index(value_index)
                    };
                    if let Some(at) = at {
                        let at = at.min(list.len());
                        list.insert(at, value);
                    }
                }
            }
            Op::ReplaceList(list, e, value) => {
                let at = e.map(|e| self.eval(e, actor));
                let value = self.eval_value(value, actor);
                if let Some(list) = self.resolve_list(list) {
                    ensure!(
                        !contains_list(&value, &list),
                        "cyclic list at {}",
                        self.program.sources[pc]
                    );
                    let mut list = list.borrow_mut();
                    let at = at.map_or_else(
                        || Some(list.len().saturating_sub(1)),
                        |at| {
                            if self.program.semantics == RuntimeSemantics::Kitten4 {
                                k4_splice_index(at, list.len(), false)
                            } else {
                                list_index(at)
                            }
                        },
                    );
                    if let Some(at) = at {
                        if at >= list.len() {
                            list.push(value);
                        } else {
                            list[at] = value;
                        }
                    }
                }
            }
            Op::CopyList(source, target) => {
                if let (Some(source), Some(target)) =
                    (self.resolve_list(source), self.resolve_list(target))
                {
                    let copied = source.borrow().iter().map(Cell::deep_clone).collect();
                    *target.borrow_mut() = copied;
                }
            }
            Op::Stamp(text, size, align) => {
                let size = self.eval(size, actor);
                if !self.sprites[actor].stage && size.is_finite() {
                    let text = self.eval_text(text, actor);
                    let a = &self.sprites[actor];
                    self.text_stamps.push(TextStamp {
                        before_line: self.lines.len() / 9,
                        text,
                        x: a.x,
                        y: a.y,
                        size: size.clamp(1.0, 1000.0),
                        direction: a.direction - self.program.costume_turn,
                        align,
                        color: a.color,
                    });
                }
            }
            Op::Size(e) => self.sprites[actor].size = self.eval(e, actor).clamp(1.0, 1000.0),
            Op::Clear => {
                if let Some(raster) = self.pen_rasters.get_mut(self.current_scene) {
                    *raster = None;
                }
                self.lines.clear();
                self.text_stamps.clear();
                self.pen_fills.clear();
                self.image_stamps.clear();
                self.clear = true;
            }
            Op::Branch(e, target) => {
                if !truth(self.eval(e, actor)) {
                    self.tasks[index].pc = target;
                }
            }
            Op::Jump(target) => self.tasks[index].pc = target,
            Op::Yield => return Ok(false),
            Op::Wait(e) => {
                self.tasks[index].wake = self.time + self.eval(e, actor).max(0.0);
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    // K9+f/task_update starts at the end of this update, expires
                    // no earlier than the next, and disposes at the following
                    // update's entry. Even wait 0 skips one full update.
                    self.tasks[index].wait_started = Some(self.scheduler_tick);
                    self.tasks[index].wait_finished = false;
                }
                return Ok(false);
            }
            Op::Repeat(e, end) => {
                let value = self.eval(e, actor);
                // inF4/eval_repeat_n_times compares an integer counter < times;
                // a positive fractional count executes ceil(times) iterations.
                let n = if self.program.semantics == RuntimeSemantics::Kitten4 {
                    value.ceil()
                } else {
                    value.floor()
                }
                .clamp(0.0, u32::MAX as f64) as u64;
                if n == 0 {
                    self.tasks[index].pc = end;
                } else {
                    self.tasks[index].loops.push(n);
                }
            }
            Op::Next(target, yielding) => {
                let left = self.tasks[index]
                    .loops
                    .last_mut()
                    .context("invalid repeat stack")?;
                *left -= 1;
                if *left > 0 {
                    self.tasks[index].pc = target;
                    if yielding {
                        return Ok(false);
                    }
                } else {
                    self.tasks[index].loops.pop();
                    if yielding && self.program.semantics == RuntimeSemantics::Kitten4 {
                        return Ok(false);
                    }
                }
                if !yielding && self.warp_iteration_yields() {
                    return Ok(false);
                }
            }
            Op::Range(spec, end) => {
                let RangeSpec { from, to, by } = self.program.ranges[spec];
                let from = self.eval(from, actor);
                let to = self.eval(to, actor);
                let by = self.eval(by, actor);
                ensure!(
                    from.is_finite()
                        && to.is_finite()
                        && by.is_finite()
                        && (self.program.semantics == RuntimeSemantics::KnCurrent
                            || (by + 0.5).floor() > 0.0),
                    "range requires finite endpoints and a supported step at {}",
                    self.program.sources[pc]
                );
                let value = if from <= to {
                    from.ceil()
                } else {
                    from.floor()
                };
                // KN clamps a nonpositive rounded interval to zero; direction
                // still follows the endpoints. A zero step repeats until a
                // script break/stop, rather than being silently skipped.
                let interval = (by + 0.5).floor();
                let step = if self.program.semantics == RuntimeSemantics::KnCurrent {
                    interval.max(0.0)
                } else {
                    interval
                } * if from <= to { 1.0 } else { -1.0 };
                if (from <= to && value > to) || (from > to && value < to) {
                    self.tasks[index].pc = end;
                } else {
                    self.tasks[index].ranges.push(RangeState {
                        value,
                        end: to,
                        step,
                    });
                }
            }
            Op::RangeNext(target, yielding) => {
                let range = self.tasks[index]
                    .ranges
                    .last_mut()
                    .context("invalid range stack")?;
                let next = range.value + range.step;
                ensure!(
                    next != range.value
                        || self.program.semantics == RuntimeSemantics::KnCurrent
                            && range.step == 0.0,
                    "range step makes no progress at {}",
                    self.program.sources[pc]
                );
                range.value = next;
                if (range.step > 0.0 && next <= range.end)
                    || (range.step < 0.0 && next >= range.end)
                    || (self.program.semantics == RuntimeSemantics::KnCurrent && range.step == 0.0)
                {
                    self.tasks[index].pc = target;
                    if yielding {
                        return Ok(false);
                    }
                } else {
                    self.tasks[index].ranges.pop();
                    if yielding && self.program.semantics == RuntimeSemantics::Kitten4 {
                        return Ok(false);
                    }
                }
                if !yielding && self.warp_iteration_yields() {
                    return Ok(false);
                }
            }
            Op::Break(target, pop) => {
                if pop == 1 {
                    self.tasks[index].loops.pop();
                } else if pop == 2 {
                    self.tasks[index].ranges.pop();
                }
                self.tasks[index].pc = target;
            }
            Op::Log(i) => {
                if self.logs.len() < 1024 {
                    self.logs.push(self.program.strings[i].clone());
                }
            }
            Op::Audio(i, play) => {
                let audio = self.eval_value(i, actor);
                self.audio_commands.push(AudioCommand {
                    audio,
                    play,
                    wait: None,
                    property: None,
                });
            }
            Op::AudioProperty(audio, value, rate, change, decrease) => {
                // The official audio module checks typeof, without numeric coercion.
                if let Cell::Number(value) = self.eval_value(value, actor)
                    && value.is_finite()
                {
                    let audio = self.eval_value(audio, actor);
                    self.audio_commands.push(AudioCommand {
                        audio,
                        play: false,
                        wait: None,
                        property: Some(AudioProperty {
                            rate,
                            change,
                            value: value / 100.0 * if change && decrease { -1.0 } else { 1.0 },
                        }),
                    });
                }
            }
            Op::LogNumber(e) => {
                let n = self.eval(e, actor);
                if self.logs.len() < 1024 {
                    self.logs.push(crate::js_number::text(n));
                }
            }
            Op::LogText(text) => {
                if self.logs.len() < 1024 {
                    let value = self.eval_text(text, actor);
                    self.logs.push(value);
                }
            }
            Op::WaitUntil(e) => {
                if !truth(self.eval(e, actor)) {
                    self.tasks[index].pc = pc;
                    return Ok(false);
                }
            }
            Op::Broadcast(message, payload, wait) => {
                let message = self.eval_value(message, actor).text();
                let payload = payload.map_or(Cell::Number(f64::NAN), |i| self.eval_value(i, actor));
                self.broadcast(message, payload, wait)?;
                if self.tasks[index].pending > 0 {
                    return Ok(false);
                }
            }
            Op::Stop(scope) => {
                if scope == 0 {
                    self.stopped = true;
                }
                for target in 0..self.tasks.len() {
                    let stop = match scope {
                        0 => true,
                        1 => target == index,
                        2 => target != index && self.tasks[target].actor == actor,
                        3 => self.tasks[target].actor != actor,
                        _ => unreachable!(),
                    };
                    if stop {
                        self.finish_task(target);
                    }
                }
                if self.tasks[index].done {
                    return Ok(false);
                }
            }
            Op::Call(procedure, args) => {
                let count = self.program.call_arguments[args].len();
                let mut parameters = Vec::with_capacity(count);
                for k in 0..count {
                    let value = self.program.call_arguments[args][k];
                    parameters.push(self.eval_value(value, actor));
                }
                let task = &mut self.tasks[index];
                ensure!(
                    task.calls.len() < 10_000,
                    "procedure stack limit at {}",
                    self.program.sources[pc]
                );
                task.calls.push(CallFrame {
                    pc: task.pc,
                    parameters: std::mem::replace(&mut task.parameters, parameters),
                    loops: task.loops.len(),
                    ranges: task.ranges.len(),
                });
                task.pc = self.program.procedure_entries[procedure];
            }
            Op::Return | Op::ReturnValue(_) => {
                if let Op::ReturnValue(value) = op {
                    let value = self.eval_value(value, actor);
                    self.tasks[index].returned = Some(value);
                }
                let task = &mut self.tasks[index];
                let call = task.calls.pop().context("invalid procedure return")?;
                task.pc = call.pc;
                task.parameters = call.parameters;
                task.loops.truncate(call.loops);
                task.ranges.truncate(call.ranges);
            }
            Op::ChangeScale(e) => {
                let value = self.eval(e, actor);
                let a = &mut self.sprites[actor];
                if !value.is_finite() {
                    // Official setters ignore non-finite input (docs/nonfinite.md).
                } else if self.program.semantics == RuntimeSemantics::Kitten4 {
                    a.size_x = (a.size_x * a.scale / 100.0 + value).max(0.0);
                    a.size_y = (a.size_y * a.scale / 100.0 + value).max(0.0);
                    a.scale = 100.0;
                } else {
                    a.scale += value;
                }
            }
            Op::SizeAxis(height, e, add) => {
                let v = self.eval(e, actor);
                if !v.is_finite() {
                    return Ok(true);
                }
                let a = &mut self.sprites[actor];
                if self.program.semantics == RuntimeSemantics::Kitten4 {
                    // K4 axes are absolute percentages, not multipliers on the
                    // uniform size. Preserve the other axis when normalizing.
                    if !v.is_finite() {
                        return Ok(false);
                    }
                    a.size_x *= a.scale / 100.0;
                    a.size_y *= a.scale / 100.0;
                    a.scale = 100.0;
                }
                let target = if height { &mut a.size_y } else { &mut a.size_x };
                let next = if add { *target + v } else { v };
                *target = if self.program.semantics == RuntimeSemantics::Kitten4 {
                    next.max(0.0)
                } else {
                    next
                };
            }
            Op::PenSizeChange(e) => {
                let v = self.eval(e, actor);
                let a = &mut self.sprites[actor];
                a.size = (a.size + v).clamp(1.0, 1000.0);
            }
            Op::Effect(scope, e, change) => {
                let v = self.eval(e, actor);
                if v.is_finite() {
                    let a = &mut self.sprites[actor];
                    if scope == 1 {
                        let ghost = (1.0 - a.opacity) * 100.0;
                        let ghost = if change { ghost + v } else { v };
                        a.opacity = 1.0 - ghost.clamp(0.0, 100.0) / 100.0;
                    } else {
                        let slot = &mut a.effects[scope as usize];
                        let next = if change {
                            *slot + v
                        } else if scope == 2 && self.program.semantics == RuntimeSemantics::Kitten4
                        {
                            v - 100.0
                        } else {
                            v
                        };
                        *slot = match scope {
                            2 => next.clamp(-100.0, 100.0),
                            6 => next.clamp(0.0, 100.0),
                            _ => next,
                        };
                    }
                }
            }
            Op::ClearEffects => {
                let a = &mut self.sprites[actor];
                a.effects = [0.0; 7];
                a.opacity = 1.0;
            }
            Op::RotationType(kind) => self.sprites[actor].rotation_type = kind,
            Op::Flip(y) => {
                let a = &mut self.sprites[actor];
                if y {
                    a.flip_y = !a.flip_y;
                } else {
                    a.flip_x = !a.flip_x;
                }
            }
            Op::FaceTo(target) => {
                let (x, y) = self.point(target, actor);
                let a = &mut self.sprites[actor];
                let (dx, dy) = (x - a.x, y - a.y);
                if dx != 0.0 || dy != 0.0 {
                    a.direction = dx.atan2(dy).to_degrees();
                }
            }
            Op::MoveToTarget(target) => {
                let (x, y) = self.point(target, actor);
                self.sprites[actor].x = x;
                self.sprites[actor].y = y;
                self.line(actor, old);
            }
            Op::RotateAround(target, e) => {
                let degrees = self.eval(e, actor);
                if !degrees.is_finite() {
                    return Ok(true);
                }
                let center = self.point(target, actor);
                let (sin, cos) = degrees.to_radians().sin_cos();
                let a = &mut self.sprites[actor];
                let (dx, dy) = (a.x - center.0, a.y - center.1);
                // Clockwise, like turning right.
                a.x = center.0 + dx * cos + dy * sin;
                a.y = center.1 - dx * sin + dy * cos;
                a.direction += degrees;
                self.line(actor, old);
            }
            Op::Glide(spec) => {
                let GlideSpec {
                    time,
                    x,
                    y,
                    relative,
                } = self.program.glides[spec];
                let duration = self.eval(time, actor);
                let from = (self.sprites[actor].x, self.sprites[actor].y);
                let mut to = from;
                if let Some(x) = x {
                    to.0 = self.eval(x, actor) + if relative { from.0 } else { 0.0 };
                }
                if let Some(y) = y {
                    to.1 = self.eval(y, actor) + if relative { from.1 } else { 0.0 };
                }
                if !to.0.is_finite() {
                    to.0 = from.0;
                }
                if !to.1.is_finite() {
                    to.1 = from.1;
                }
                self.tasks[index].anim = Some(Anim::Glide {
                    start: self.time,
                    duration: if duration.is_finite() {
                        duration.max(0.0)
                    } else {
                        0.0
                    },
                    from,
                    to,
                });
            }
            Op::Fade(time, show) => {
                let duration = self.eval(time, actor);
                let a = &mut self.sprites[actor];
                let from = if show { 0.0 } else { a.opacity };
                if show {
                    a.visible = true;
                    a.opacity = 0.0;
                }
                self.dirty[actor] = true;
                self.tasks[index].anim = Some(Anim::Fade {
                    start: self.time,
                    duration: if duration.is_finite() {
                        duration.max(0.0)
                    } else {
                        0.0
                    },
                    from,
                    to: if show { 1.0 } else { 0.0 },
                    hide: !show,
                });
            }
            Op::AnimStep => {
                let Some(anim) = self.tasks[index].anim else {
                    return Ok(true);
                };
                let (start, duration) = match anim {
                    Anim::Glide {
                        start, duration, ..
                    }
                    | Anim::Fade {
                        start, duration, ..
                    } => (start, duration),
                };
                let t = if duration <= 0.0 {
                    1.0
                } else {
                    ((self.time - start) / duration).clamp(0.0, 1.0)
                };
                self.dirty[actor] = true;
                match anim {
                    Anim::Glide { from, to, .. } => {
                        let old = (self.sprites[actor].x, self.sprites[actor].y);
                        self.sprites[actor].x = from.0 + (to.0 - from.0) * t;
                        self.sprites[actor].y = from.1 + (to.1 - from.1) * t;
                        self.line(actor, old);
                    }
                    Anim::Fade { from, to, hide, .. } => {
                        let a = &mut self.sprites[actor];
                        a.opacity = from + (to - from) * t;
                        if t >= 1.0 && hide {
                            a.visible = false;
                            a.opacity = from;
                        }
                    }
                }
                if t < 1.0 {
                    self.tasks[index].pc = pc;
                    return Ok(false);
                }
                self.tasks[index].anim = None;
            }
            Op::Tell(target, start, wait) => {
                let target = if target == usize::MAX { actor } else { target };
                ensure!(
                    self.tasks.len() < 4096,
                    "task limit exceeded at {}",
                    self.program.sources[pc]
                );
                let script = Script {
                    start,
                    hat: self.program.sources[pc].clone(),
                    actor: target,
                    event: ScriptEvent::Start,
                };
                let mut task = Task::new(self.next_task_id, &script, &self.program);
                self.next_task_id += 1;
                task.locals.clone_from(&self.tasks[index].locals);
                task.local_values
                    .clone_from(&self.tasks[index].local_values);
                if wait {
                    task.waiter = Some(self.tasks[index].id);
                    self.tasks[index].pending += 1;
                }
                self.ready.push_back(self.tasks.len());
                self.tasks.push(task);
                if wait {
                    return Ok(false);
                }
            }
            Op::Restart => {
                self.restart = true;
                return Ok(false);
            }
            Op::Clone(target) => {
                let source = if target == usize::MAX { actor } else { target };
                self.clone_sprite(source, None)?;
            }
            Op::Split(target, x, y) => {
                let source = if target == usize::MAX { actor } else { target };
                let position = (self.eval(x, actor), self.eval(y, actor));
                self.clone_sprite(source, Some(position))?;
            }
            Op::Dialog(text, think) => {
                let text = self.eval_value(text, actor).text();
                self.sprites[actor].dialog = (!text.is_empty()).then_some(Dialog { text, think });
                self.dirty[actor] = true;
            }
            Op::CloseDialog => {
                self.sprites[actor].dialog = None;
                self.dirty[actor] = true;
            }
            Op::Ask(question, choices) => {
                let question = self.eval_value(question, actor).text();
                let choices = choices.map(|span| {
                    (span.start..span.start + span.len)
                        .map(|k| {
                            let value = self.program.value_args[k as usize];
                            self.eval_value(value, actor).text()
                        })
                        .collect()
                });
                self.asks.push_back(AskRequest {
                    id: self.next_ask,
                    sprite: if self.sprites[actor].stage {
                        String::new()
                    } else {
                        self.sprites[actor].id.clone()
                    },
                    question,
                    choices,
                    task: self.tasks[index].id,
                });
                self.next_ask += 1;
                // Suspended until the viewer answers (see Engine::answer).
                self.tasks[index].pending += 1;
                return Ok(false);
            }
            Op::Camp(camp) => self.sprites[actor].camp = camp,
            Op::Emphasis(_) | Op::Transition(..) => {
                if !self.sprites[actor].stage {
                    self.tasks[index].timeline = self.timeline(actor, op).map(Box::new);
                    self.dirty[actor] = true;
                }
            }
            Op::TimelineStep => {
                if !self.timeline_step(index, actor) {
                    self.tasks[index].pc = pc;
                    return Ok(false);
                }
            }
            Op::SpriteText(value) => {
                if !self.sprites[actor].stage {
                    let text = self.eval_value(value, actor).text().trim().to_owned();
                    self.set_sprite_text(actor, Some(text));
                    return Ok(false);
                }
            }
            Op::TextSize(size) => {
                let size = self.eval(size, actor);
                if !self.sprites[actor].stage && size.is_finite() {
                    self.sprites[actor].text_style.0 = size.clamp(1.0, 2000.0);
                    self.set_sprite_text(actor, None);
                    return Ok(false);
                }
            }
            Op::TextColor(rgb) => {
                if !self.sprites[actor].stage {
                    self.sprites[actor].text_style.1 = rgb;
                    self.set_sprite_text(actor, None);
                    return Ok(false);
                }
            }
            Op::Bounce => {
                let old = (self.sprites[actor].x, self.sprites[actor].y);
                self.bounce(actor);
                if self.sprites[actor].fill_path.is_some() {
                    self.line(actor, old);
                }
            }
            Op::Draggable(on) => {
                self.sprites[actor].draggable = on;
                self.dirty[actor] = true;
            }
            Op::ImageStamp => {
                if !self.sprites[actor].stage && self.image_stamps.len() < 1024 {
                    if self.program.uses_color {
                        self.raster_stamp(actor);
                    }
                    let a = &self.sprites[actor];
                    self.image_stamps.push(ImageStamp {
                        before_line: self.lines.len() / 9,
                        style: a.style.clone(),
                        x: a.x,
                        y: a.y,
                        direction: a.direction - self.program.costume_turn,
                        scale: a.scale,
                        size_x: a.size_x * if a.flip_x { -1.0 } else { 1.0 },
                        size_y: a.size_y * if a.flip_y { -1.0 } else { 1.0 },
                        rotation_type: a.rotation_type,
                        opacity: a.opacity,
                        effects: a.effects,
                    });
                }
            }
            Op::AudioWait(value) => {
                let audio = self.eval_value(value, actor);
                let wait = self.next_audio_wait;
                self.next_audio_wait += 1;
                self.audio_commands.push(AudioCommand {
                    audio,
                    play: true,
                    wait: Some(wait),
                    property: None,
                });
                self.audio_waits.push((self.tasks[index].id, wait));
                self.tasks[index].pending += 1;
                return Ok(false);
            }
            Op::Monitor(monitor, visible) => {
                if self.monitors.len() <= monitor {
                    self.monitors.resize(monitor + 1, false);
                }
                self.monitors[monitor] = visible;
            }
            Op::SceneTransition(direction, kind) => {
                let direction = self.eval_value(direction, actor).text();
                let kind = self.eval_value(kind, actor).text();
                self.next_transition = (!matches!(kind.as_str(), "" | "none"))
                    .then_some(Transition { direction, kind });
            }
            Op::SwitchScene(value) => {
                let value = self.eval_value(value, actor);
                let target = self.find_scene(&value).with_context(|| {
                    format!(
                        "unknown scene {} at block {}",
                        value.text(),
                        self.program.sources[pc]
                    )
                })?;
                if target != self.current_scene {
                    self.switch_scene(target);
                    if self.program.semantics == RuntimeSemantics::KnCurrent
                        || !self.tasks[index].global_start
                    {
                        return Ok(false);
                    }
                }
            }
            Op::DisposeClone => {
                if self.sprites[actor].clone_index > 0 {
                    self.delete_clone(actor);
                    return Ok(false);
                }
            }
            Op::DisposeSelf => {
                self.delete_clone(actor);
                return Ok(false);
            }
            Op::Layer(movement) => {
                if !self.sprites[actor].stage {
                    self.move_layer(actor, movement);
                }
            }
            Op::Halt => {
                self.finish_task(index);
                return Ok(false);
            }
        }
        if self.value_error.is_some() {
            let error = self.value_error.take().unwrap_or_default();
            bail!("{error} at block {}", self.program.sources[pc]);
        }
        // Nonfinite arithmetic is not a VM error. Input guards above implement
        // the official setters; finite arithmetic can still overflow naturally.
        Ok(true)
    }
    fn output_limit_reached(&self) -> bool {
        self.lines.len() >= 9 * 65536
            || self.text_stamps.len() >= 1024
            || self.pen_fills.len() >= 1024
            || self
                .pen_fills
                .iter()
                .map(|fill| fill.points.len())
                .sum::<usize>()
                >= 65536
            || self.audio_commands.len() >= 1024
    }
    /// One scheduler pass. Returns whether the instruction/time/output budget ended it.
    fn tick(
        &mut self,
        dt: f64,
        max_instructions: usize,
        budget: Duration,
        started: Instant,
        total_count: &mut usize,
    ) -> Result<bool> {
        self.scheduler_tick += 1;
        // K9+f/update_dispose removes blockers at update entry. Expiration is
        // observed at the previous update's end, not guessed using a 60 Hz delta.
        for task in &mut self.tasks {
            if task.wait_finished {
                task.wait_started = None;
                task.wait_finished = false;
            }
        }
        self.time += dt;
        if self.timer_running {
            self.timer += dt;
        }
        self.received.clear();
        self.clone_counts.clear();
        self.step_physics(dt);
        self.check_bumps();
        self.dispatch_held_keys();
        let mut count = *total_count;
        let mut exceeded = false;
        let total = self.tasks.len();
        self.ready.clear();
        self.ready
            .extend((0..total).map(|i| (self.cursor + i) % total));
        if self.program.semantics == RuntimeSemantics::Kitten4 {
            // iNFq/get_interpreter_sorters + reverse step_code traversal:
            // listeners first, newest frame first, stable creation order last.
            self.ready.make_contiguous().sort_by_key(|&index| {
                let task = &self.tasks[index];
                let listener = self
                    .program
                    .scripts
                    .get(task.script)
                    .is_some_and(|s| matches!(s.event, ScriptEvent::Broadcast(..)));
                (!listener, std::cmp::Reverse(task.created), task.id)
            });
        }
        while let Some(index) = self.ready.pop_front() {
            if self.restart {
                break;
            }
            if !self.task_runnable(&self.tasks[index]) {
                continue;
            }
            let actor = self.tasks[index].actor;
            self.trace_task("resume", index, None);
            self.current_task = index;
            self.warp_iterations = 0;
            let mut clock_due = false;
            let mut since_clock = 0usize;
            loop {
                if count >= max_instructions
                    || ((std::mem::take(&mut clock_due) || count.is_multiple_of(256))
                        && started.elapsed() >= budget)
                    || self.output_limit_reached()
                {
                    exceeded = true;
                    self.cursor = (index + 1) % self.tasks.len();
                    break;
                }
                let pc = self.tasks[index].pc;
                if let Some(used) = self.jit_try(index, pc, actor, max_instructions - count) {
                    count += used;
                    if let Some(error) = self.jit_error.take() {
                        return Err(error);
                    }
                    since_clock += used;
                    if since_clock >= 8192 {
                        since_clock = 0;
                        clock_due = true;
                    }
                    continue;
                }
                let op = self.program.ops[pc];
                self.trace_task("block", index, Some(pc));
                let lengths = self.trace_list_lengths();
                self.tasks[index].pc += 1;
                count += 1;
                let result = self.exec(index, pc, op, actor);
                self.trace_list_changes(index, pc, lengths);
                let continuing = result?;
                if !continuing || self.tasks[index].done {
                    self.trace_task(
                        if self.tasks[index].done {
                            "finish"
                        } else {
                            "yield"
                        },
                        index,
                        Some(pc),
                    );
                    break;
                }
            }
            if exceeded {
                break;
            }
        }
        for task in &mut self.tasks {
            if task
                .wait_started
                .is_some_and(|tick| tick < self.scheduler_tick)
                && task.wake <= self.time
            {
                task.wait_finished = true;
            }
        }
        // Rebase the round-robin cursor when finished tasks are compacted. Wait
        // dependencies use stable IDs, never indices into this compacted vector.
        self.cursor = if exceeded {
            self.tasks
                .iter()
                .take(self.cursor)
                .filter(|t| !t.done)
                .count()
        } else {
            0
        };
        self.tasks.retain(|t| !t.done);
        self.released.clear();
        self.pointer_clicked = false;
        self.pointer_released = false;
        if std::mem::take(&mut self.restart) {
            self.start();
        }
        *total_count = count;
        Ok(exceeded)
    }
}

/// Back-to-front draw order per scene (actorIds are front to back).
fn initial_orders(program: &Program) -> Vec<Vec<usize>> {
    program
        .scenes
        .iter()
        .map(|scene| scene.actors.iter().rev().copied().collect())
        .collect()
}

/// Wire format: u32 LE metadata length (padded to 4 bytes), JSON metadata, f32 LE lines.
pub fn encode_frame(frame: &Frame) -> Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(1024 + frame.lines.len() * 4);
    bytes.extend_from_slice(&[0; 4]);
    serde_json::to_writer(&mut bytes, frame)?;
    while bytes.len() % 4 != 0 {
        bytes.push(b' ');
    }
    let length = (bytes.len() - 4) as u32;
    bytes[..4].copy_from_slice(&length.to_le_bytes());
    bytes.reserve(frame.lines.len() * 4);
    for f in &frame.lines {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    Ok(bytes)
}

/// [year, month, date, -, weekday (Sunday 0), hour, minute, second] in local time.
fn local_time(offset_min: f64) -> [f64; 8] {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64());
    let local = (now + offset_min * 60.0).floor() as i64;
    let days = local.div_euclid(86_400);
    let secs = local.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let weekday = (days + 4).rem_euclid(7);
    [
        year as f64,
        month as f64,
        day as f64,
        0.0,
        weekday as f64,
        (secs / 3600) as f64,
        (secs / 60 % 60) as f64,
        (secs % 60) as f64,
    ]
}

fn split_token(text: &str) -> Cell {
    // Kitten N applies JavaScript Number to nonblank split tokens, preserving NaN text.
    let trimmed = text.trim();
    let radix = [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ]
    .into_iter()
    .find_map(|(prefix, base)| trimmed.strip_prefix(prefix).map(|digits| (digits, base)));
    let number = if let Some((digits, base)) = radix {
        u64::from_str_radix(digits, base).ok().map(|n| n as f64)
    } else if matches!(trimmed, "inf" | "+inf" | "-inf") {
        None
    } else {
        trimmed.parse::<f64>().ok().filter(|n| !n.is_nan())
    };
    number.map_or_else(|| Cell::Text(text.into()), Cell::Number)
}

fn contains_list(value: &Cell, target: &List) -> bool {
    if let Cell::List(v) = value {
        Rc::ptr_eq(v, target) || v.borrow().iter().any(|v| contains_list(v, target))
    } else {
        false
    }
}

fn list_index(value: f64) -> Option<usize> {
    value
        .is_finite()
        .then(|| ((value + 0.5).floor().max(1.0) - 1.0) as usize)
}

fn read_list_index(value: f64, len: usize, semantics: RuntimeSemantics) -> Option<usize> {
    if semantics != RuntimeSemantics::Kitten4 {
        return list_index(value);
    }
    // Official lists_get_value uses JS property access, not rounded/clamped indices.
    let index = if value > 0.0 {
        value - 1.0
    } else {
        len as f64 + value
    };
    (value != 0.0 && index.is_finite() && index.fract() == 0.0 && index >= 0.0)
        .then_some(index as usize)
}

fn k4_splice_index(value: f64, len: usize, insert: bool) -> Option<usize> {
    if value.is_nan() || value == 0.0 {
        return None;
    }
    // Array.splice truncates its start and clamps it relative to the current length.
    let start = if value > 0.0 {
        value - 1.0
    } else {
        value + f64::from(insert)
    }
    .trunc();
    Some(if start < 0.0 {
        (len as f64 + start).max(0.0) as usize
    } else {
        start.min(len as f64) as usize
    })
}
fn rgb_to_hsv(color: [f32; 4]) -> [f64; 3] {
    let [r, g, b, _] = color.map(f64::from);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let hue = if delta == 0.0 {
        0.0
    } else if max == r {
        60.0 * ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    [hue, if max == 0.0 { 0.0 } else { delta / max }, max]
}

impl Sprite {
    fn set_pen_property(&mut self, property: PenProperty, value: f64, change: i8) {
        let changed = |current| {
            if change == 0 {
                value
            } else {
                current + value * f64::from(change)
            }
        };
        let (index, scale) = match property {
            PenProperty::Hue => (0, 1.0),
            PenProperty::Saturation => (1, 100.0),
            PenProperty::Brightness => (2, 100.0),
            PenProperty::Alpha => {
                let current = (1.0 - f64::from(self.color[3])) * 100.0;
                let transparency = changed(current).clamp(0.0, 100.0);
                self.color[3] = (1.0 - transparency / 100.0) as f32;
                return;
            }
        };
        let v = changed(self.hsv[index] * scale);
        self.hsv[index] = if index == 0 {
            v.rem_euclid(360.0)
        } else {
            v.clamp(0.0, 100.0) / 100.0
        };
        // The official brush stores HSL; HSV -> HSL at black loses saturation.
        if index != 0 && self.hsv[2] == 0.0 {
            self.hsv[1] = 0.0;
        }
        let [h, s, v] = self.hsv;
        let c = v * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = v - c;
        let rgb = match (h / 60.0) as u8 {
            0 => [c, x, 0.0],
            1 => [x, c, 0.0],
            2 => [0.0, c, x],
            3 => [0.0, x, c],
            4 => [x, 0.0, c],
            _ => [c, 0.0, x],
        };
        for (dst, src) in self.color[..3].iter_mut().zip(rgb) {
            *dst = (src + m) as f32;
        }
    }
}

#[cfg(test)]
mod pivot_tests {
    use super::*;
    use serde_json::json;

    fn engine() -> Engine {
        let p = crate::studio::document::Document::blank().value().clone();
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        vm.set_costume(
            "nekoc-costume",
            Costume {
                width: 20.0,
                height: 12.0,
                center_point: [10.0, 6.0],
                // Top-left only, so tests detect mirrored/rotated mask coordinates.
                mask: Some((2, 2, vec![1])),
                rgb: Some(vec![255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]),
            },
        );
        let a = &mut vm.sprites[1];
        a.x = 30.0;
        a.y = 40.0;
        vm
    }

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
    }

    #[test]
    fn renderer_pivot_cases_match_bounds_masks_and_colours() {
        let cases: Value = serde_json::from_str(include_str!("../tests/pivot-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let mut vm = engine();
            vm.program.costume_turn = case["turn"].as_f64().unwrap();
            let a = &mut vm.sprites[1];
            a.direction = case["direction"].as_f64().unwrap();
            a.rotation_type = case["rotation_type"].as_u64().unwrap() as u8;
            a.scale = case["scale"].as_f64().unwrap();
            a.size_x = case["size_x"].as_f64().unwrap();
            a.size_y = case["size_y"].as_f64().unwrap();
            let g = vm.geometry(1).unwrap();
            for (actual, expected) in [g.x, g.y]
                .into_iter()
                .zip(case["center"].as_array().unwrap())
            {
                close(actual, expected.as_f64().unwrap());
            }
            for (actual, expected) in [g.width, g.height, g.angle.to_degrees()]
                .into_iter()
                .zip(case["drawn"].as_array().unwrap())
            {
                close(actual, expected.as_f64().unwrap());
            }
            let (l, r, b, t) = vm.bounds(1);
            for (actual, expected) in [l, r, b, t]
                .into_iter()
                .zip(case["bounds"].as_array().unwrap())
            {
                close(actual, expected.as_f64().unwrap());
            }
            for (u, v, hit) in [
                (0.25, 0.25, true),
                (0.75, 0.25, false),
                (0.25, 0.75, false),
                (-0.1, 0.5, false),
            ] {
                // Independent forward transform using the shared renderer fixture.
                let angle = case["drawn"][2].as_f64().unwrap().to_radians();
                let (s, c) = angle.sin_cos();
                let dx = (u - 0.5) * case["drawn"][0].as_f64().unwrap();
                let dy = (0.5 - v) * case["drawn"][1].as_f64().unwrap();
                let x = case["center"][0].as_f64().unwrap() + c * dx + s * dy;
                let y = case["center"][1].as_f64().unwrap() - s * dx + c * dy;
                assert_eq!(vm.contains(1, x, y), hit, "{}", case["name"]);
                assert_eq!(vm.color_at(1, x, y).is_some(), hit);
                vm.set_mouse(x, y);
                assert_eq!(vm.touching(1, TARGET_MOUSE), hit);
            }
            let (x, y) = vm.geometry(1).unwrap().point(0.25, 0.25);
            vm.raster_stamp(1);
            assert_eq!(vm.stage_color(x, y, 1, &[]), [255.0, 0.0, 0.0]);
            assert_eq!(vm.stage_color(200.0, 200.0, 1, &[]), [255.0; 3]);
        }
    }

    #[test]
    fn zero_pivot_preserves_centred_geometry_and_empty_costumes_do_not_hit() {
        let mut vm = engine();
        vm.program
            .costumes
            .get_mut("nekoc-costume")
            .unwrap()
            .center_point = [0.0; 2];
        for turn in [0.0, 90.0] {
            vm.program.costume_turn = turn;
            for rotation_type in [0, 1, 2] {
                for direction in [0.0, 90.0, 180.0, -90.0] {
                    let a = &mut vm.sprites[1];
                    a.direction = direction;
                    a.rotation_type = rotation_type;
                    a.scale = 200.0;
                    a.size_x = 150.0;
                    a.size_y = 50.0;
                    let angle = if rotation_type == 0 {
                        (direction - turn).to_radians()
                    } else {
                        0.0
                    };
                    let (s, c) = angle.sin_cos();
                    let ex = 30.0 * c.abs() + 6.0 * s.abs();
                    let ey = 30.0 * s.abs() + 6.0 * c.abs();
                    let (l, r, b, t) = vm.bounds(1);
                    for (actual, expected) in
                        [l, r, b, t]
                            .into_iter()
                            .zip([30.0 - ex, 30.0 + ex, 40.0 - ey, 40.0 + ey])
                    {
                        close(actual, expected);
                    }
                    let g = vm.geometry(1).unwrap();
                    assert_eq!((g.x, g.y), (30.0, 40.0));
                }
            }
        }
        vm.sprites[1].scale = 0.0;
        assert!(!vm.contains(1, 30.0, 40.0));
        assert!(vm.color_at(1, 30.0, 40.0).is_none());
    }

    #[test]
    fn pivot_overlap_colour_sensing_and_pen_stamp_use_the_same_position() {
        let mut vm = engine();
        // At zero rotation the centre would be (-80, 0), far from actor position.
        vm.program
            .costumes
            .get_mut("nekoc-costume")
            .unwrap()
            .center_point = [80.0, 0.0];
        vm.sprites[1].x = 0.0;
        vm.sprites[1].y = 0.0;
        vm.sprites[1].direction = 90.0;
        // At 90 degrees the opaque top-left quarter lies near (3, 85).
        let (x, y) = vm.geometry(1).unwrap().point(0.25, 0.25);
        vm.sprites.push(vm.sprites[1].clone());
        vm.sprites[2].style = Some("probe".into());
        vm.sprites[2].x = x;
        vm.sprites[2].y = y;
        vm.sprites[2].direction = 0.0;
        vm.set_costume(
            "probe",
            Costume {
                width: 2.0,
                height: 2.0,
                mask: Some((1, 1, vec![1])),
                rgb: Some(vec![0, 0, 255]),
                ..Costume::default()
            },
        );
        vm.order.push(2);
        assert!(vm.overlap(1, 2));
        assert!(vm.touching_color(2, 0xff0000)); // other actor's inverse transform
        assert!(vm.touching_color(1, 0x0000ff)); // subject's forward transform
        vm.raster_stamp(1);
        vm.sprites[1].visible = false;
        assert!(vm.touching_color(2, 0xff0000)); // red remains in pen raster
        assert_eq!(vm.stage_color(0.0, 0.0, 2, &[]), [255.0; 3]);
        vm.sprites[2].x = 0.0;
        vm.sprites[2].y = 0.0;
        assert!(!vm.overlap(1, 2));
        assert!(!vm.touching_color(2, 0xff0000));
    }

    #[test]
    fn pivot_edge_detection_and_bounce_correct_the_reflected_bounds() {
        let mut vm = engine();
        vm.program
            .costumes
            .get_mut("nekoc-costume")
            .unwrap()
            .center_point = [-30.0, 0.0];
        vm.sprites[1].x = vm.program.width / 2.0 - 20.0;
        vm.sprites[1].y = 0.0;
        vm.sprites[1].direction = 45.0;
        assert!(vm.touching(1, TARGET_EDGE));
        vm.bounce(1);
        close(vm.sprites[1].direction, -45.0);
        let (l, r, b, t) = vm.bounds(1);
        assert!(l >= -vm.program.width / 2.0 && r <= vm.program.width / 2.0 + 1e-9);
        assert!(b >= -vm.program.height / 2.0 && t <= vm.program.height / 2.0);
    }

    #[test]
    fn pivot_registration_defaults_invalid_components_without_changing_size_policy() {
        assert_eq!(
            Costume::center_point_from_json(&json!({"x":"bad","y":6})),
            [0.0, 6.0]
        );
        assert_eq!(Costume::center_point_from_json(&Value::Null), [0.0; 2]);
        let mut vm = engine();
        let mut costume = vm.program.costumes["nekoc-costume"].clone();
        costume.center_point = [f64::NAN, f64::INFINITY];
        vm.set_costume("nekoc-costume", costume.clone());
        assert_eq!(vm.program.costumes["nekoc-costume"].center_point, [0.0; 2]);
        costume.width = f64::NAN;
        costume.center_point = [1.0; 2];
        vm.set_costume("nekoc-costume", costume);
        assert_eq!(vm.program.costumes["nekoc-costume"].width, 20.0);
        assert_eq!(vm.program.costumes["nekoc-costume"].center_point, [0.0; 2]);
        let mut p = crate::studio::document::Document::blank().value().clone();
        p["styles"]["stylesDict"]["nekoc-costume"] = json!({
            "width":20,"height":12,"centerPoint":{"x":10,"y":6}
        });
        let program = Program::compile(&p).unwrap();
        assert_eq!(program.costumes["nekoc-costume"].center_point, [10.0, 6.0]);
    }
}

#[cfg(test)]
mod nonfinite_geometry_tests {
    use super::*;

    #[test]
    fn nan_scale_is_not_hittable_and_bounce_does_not_repair_it() {
        let document = crate::studio::document::Document::blank();
        let mut vm = Engine::new(Program::compile(document.value()).unwrap());
        let i = vm.sprites.iter().position(|s| !s.stage).unwrap();
        let style = vm.sprites[i].style.clone().unwrap();
        vm.set_costume(
            &style,
            Costume {
                width: 20.0,
                height: 20.0,
                ..Costume::default()
            },
        );
        vm.sprites[i].x = 100.0;
        vm.sprites[i].y = 20.0;
        vm.sprites[i].visible = true;
        vm.sprites[i].scale = 80.0;
        assert!(vm.contains(i, 100.0, 20.0));
        assert!(vm.overlap(i, i));
        vm.sprites[i].scale = f64::NAN;
        assert!(!vm.contains(i, 100.0, 20.0));
        assert!(!vm.contains(i, 0.0, 0.0));
        assert!(!vm.overlap(i, i));
        vm.bounce(i);
        assert!(vm.sprites[i].scale.is_nan());
        assert_eq!((vm.sprites[i].x, vm.sprites[i].y), (100.0, 20.0));
        assert!(vm.sprites[i].visible);
        vm.sprites[i].scale = 80.0;
        assert!(vm.contains(i, 100.0, 20.0));
        assert!(vm.overlap(i, i));
    }
}
