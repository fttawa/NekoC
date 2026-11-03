//! Precompiled numeric/pen VM for the Web player.
//! JSON is read only by the compiler. Execution uses indexed slots and instructions.
//! Unsupported blocks are compile errors, never silently treated as no-ops.
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use serde_json::Value;
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
}
impl Binary {
    fn apply(self, a: f64, b: f64) -> f64 {
        match self {
            Self::Add => a + b,
            Self::Sub => a - b,
            Self::Mul => a * b,
            Self::Div => {
                if b == 0.0 {
                    0.0
                } else {
                    a / b
                }
            }
            Self::Mod => {
                if b == 0.0 {
                    0.0
                } else {
                    a % b
                }
            }
            Self::Pow => a.powf(b),
            Self::Eq => (a == b) as u8 as f64,
            Self::Ne => (a != b) as u8 as f64,
            Self::Lt => (a < b) as u8 as f64,
            Self::Le => (a <= b) as u8 as f64,
            Self::Gt => (a > b) as u8 as f64,
            Self::Ge => (a >= b) as u8 as f64,
            Self::And => (truth(a) && truth(b)) as u8 as f64,
            Self::Or => (truth(a) || truth(b)) as u8 as f64,
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
    Not,
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
            Self::Not => (!truth(v)) as u8 as f64,
        }
    }
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
    Set(usize, Expr),
    SetValue(Target, usize),
    SetLocal(usize, Expr),
    ChangeLocal(usize, Expr, f64),
    Change(usize, Expr, f64),
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
    Color([f32; 4]),
    PenProperty(PenProperty, Expr, i8),
    Size(Expr),
    Clear,
    Audio(usize, bool),
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
    Halt,
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
    #[serde(skip)]
    styles: Vec<String>,
    #[serde(skip)]
    pen: bool,
    #[serde(skip)]
    color: [f32; 4],
    #[serde(skip)]
    hsv: [f64; 3],
    #[serde(skip)]
    size: f64,
}

#[derive(Clone, Debug)]
struct Script {
    start: usize,
    actor: usize,
    event: ScriptEvent,
}

#[derive(Clone, Debug)]
enum ScriptEvent {
    Start,
    Key(String, bool),
    Pointer(String, String),
    Broadcast(usize, bool),
}

#[derive(Debug)]
pub struct Program {
    ops: Vec<Op>,
    expressions: Vec<ExprOp>,
    /// For each postfix position, the first position of the subtree rooted there.
    /// A binary node at `p` has its right operand at `p - 1` and its left operand at
    /// `expression_starts[p - 1] - 1`, so evaluation needs no runtime value stack.
    expression_starts: Vec<u32>,
    sources: Vec<String>,
    strings: Vec<String>,
    texts: Vec<Vec<TextPart>>,
    ranges: Vec<RangeSpec>,
    initial_lists: Vec<Vec<Cell>>,
    initial_values: Vec<Option<Cell>>,
    values: Vec<ValueExpr>,
    constants: Vec<Cell>,
    value_args: Vec<usize>,
    local_count: usize,
    scripts: Vec<Script>,
    initial: Vec<f64>,
    procedure_entries: Vec<usize>,
    call_arguments: Vec<Vec<usize>>,
    pub variable_names: Vec<String>,
    pub list_names: Vec<String>,
    pub sprites: Vec<Sprite>,
    pub width: f64,
    pub height: f64,
    pub scene: String,
    pub backdrop: Option<String>,
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
impl Program {
    pub fn stats(&self) -> CompileStats {
        CompileStats {
            instructions: self.ops.len(),
            instruction_bytes: self.ops.len() * std::mem::size_of::<Op>(),
            expression_ops: self.expressions.len(),
            variables: self.initial.len(),
            lists: self.initial_lists.len(),
            scripts: self.scripts.len(),
        }
    }
    pub fn compile(project: &Value) -> Result<Self> {
        let scene = project
            .pointer("/scenes/currentSceneId")
            .and_then(Value::as_str)
            .context("project has no current scene")?
            .to_owned();
        let scene_value = project
            .pointer("/scenes/scenesDict")
            .and_then(|m| m.get(&scene))
            .context("current scene missing")?;
        let mut compiler = Compiler {
            program: Self {
                ops: vec![],
                expressions: vec![],
                expression_starts: vec![],
                sources: vec![],
                strings: vec![],
                texts: vec![],
                ranges: vec![],
                initial_lists: vec![],
                initial_values: vec![],
                values: vec![],
                constants: vec![],
                value_args: vec![],
                local_count: 0,
                scripts: vec![],
                initial: vec![],
                procedure_entries: vec![],
                call_arguments: vec![],
                variable_names: vec![],
                list_names: vec![],
                sprites: vec![],
                width: project["stageSize"]["width"].as_f64().unwrap_or(900.0),
                height: project["stageSize"]["height"].as_f64().unwrap_or(562.0),
                scene,
                backdrop: scene_value["currentStyleId"].as_str().map(str::to_owned),
            },
            slots: BTreeMap::new(),
            locals: BTreeMap::new(),
            lists: BTreeMap::new(),
            ranges: vec![],
            procedures: BTreeMap::new(),
            procedure_params: BTreeMap::new(),
            parameters: BTreeMap::new(),
            loops: vec![],
            depth: 0,
            expression_work: vec![],
            actor_ids: scene_value["actorIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
        };
        let mut definitions = vec![];
        if let Some(procedures) = project
            .pointer("/procedures/proceduresDict")
            .and_then(Value::as_object)
        {
            for (id, procedure) in procedures {
                let definition = procedure["nekoBlockJsonList"].as_array().and_then(|roots| {
                    roots
                        .iter()
                        .find(|b| b["type"] == "procedures_2_defnoreturn")
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
                        .map(|p| {
                            (
                                p["id"].as_str().unwrap_or("").to_owned(),
                                p["name"].as_str().unwrap_or("").to_owned(),
                            )
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
                let value = var.get("value").unwrap_or(&Value::Null);
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
        // Stage scripts have no sprite target. A hidden entity gives them scalar state.
        compiler.program.sprites.push(Sprite {
            id: compiler.program.scene.clone(),
            name: "Stage".into(),
            style: compiler.program.backdrop.clone(),
            x: 0.0,
            y: 0.0,
            direction: 0.0,
            scale: 100.0,
            visible: false,
            opacity: 1.0,
            styles: owner_styles(scene_value),
            pen: false,
            color: [0.0, 0.0, 0.0, 1.0],
            hsv: [0.0; 3],
            size: 1.0,
        });
        compiler.scripts(scene_value, 0)?;
        if let Some(ids) = scene_value["actorIds"].as_array() {
            for id in ids.iter().filter_map(Value::as_str) {
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
                    styles: owner_styles(actor),
                    pen: false,
                    color: [0.0, 0.0, 0.0, 1.0],
                    hsv: [0.0; 3],
                    size: 1.0,
                });
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
                    .map(|(i, (_, name))| (name.clone(), i))
                    .collect();
                compiler.program.procedure_entries[index] = compiler.program.ops.len();
                compiler.chain(definition["statements"].get("STACK"), index % 2 == 1)?;
                compiler.emit(Op::Return, definition);
            }
        }
        compiler.program.expression_starts = expression_starts(&compiler.program.expressions)?;
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

struct Compiler {
    program: Program,
    slots: BTreeMap<String, usize>,
    locals: BTreeMap<String, usize>,
    lists: BTreeMap<String, usize>,
    ranges: Vec<String>,
    procedures: BTreeMap<String, usize>,
    procedure_params: BTreeMap<usize, Vec<(String, String)>>,
    parameters: BTreeMap<String, usize>,
    loops: Vec<Vec<usize>>,
    depth: usize,
    expression_work: Vec<ExprOp>,
    actor_ids: Vec<String>,
}
fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v["fields"][key].as_str().unwrap_or("")
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
fn input<'a>(v: &'a Value, key: &str) -> Result<&'a Value> {
    v.get("inputs")
        .and_then(|m| m.get(key))
        .with_context(|| format!("{}: missing input {key}", v["type"]))
}
impl Compiler {
    fn list(&mut self, b: &Value) -> Result<ListRef> {
        match b["type"].as_str() {
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
            Some("variables_get") => match self.target(field(b, "variable")) {
                Target::Local(i) => Ok(ListRef::Local(i as u32)),
                Target::Global(i) => Ok(ListRef::Variable(i as u32)),
            },
            Some(
                "text_split"
                | "temporary_list"
                | "list_item"
                | "procedures_2_parameter"
                | "self_listen_value",
            ) => Ok(ListRef::Expression(self.value(b)? as u32)),
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
    fn value(&mut self, b: &Value) -> Result<usize> {
        let value = match b["type"].as_str().unwrap_or("") {
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
            "get_styles" => self.constant(Cell::from_json(&b["fields"]["style_id"])?),
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
            "logic_negate" => ValueExpr::Not(self.value(input(b, "logic")?)?),
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
                if let Some(i) = self.lists.get(field(b, "variable")) {
                    ValueExpr::List(ListRef::Global(*i as u32))
                } else {
                    match self.target(field(b, "variable")) {
                        Target::Global(i) => ValueExpr::Global(i),
                        Target::Local(i) => ValueExpr::Local(i),
                    }
                }
            }
            "script_variables_value" => ValueExpr::Local(self.local(field(b, "TEXT"))),
            "pure_list_get" | "list_get" => ValueExpr::List(self.list(b)?),
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
            "text_select" => ValueExpr::Select(
                self.value(input(b, "text")?)?,
                self.arg(b, "start_index")?,
                self.arg(b, "end_index")?,
            ),
            "convert_type" => {
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
    fn constant(&mut self, value: Cell) -> ValueExpr {
        self.program.constants.push(value);
        ValueExpr::Constant(self.program.constants.len() - 1)
    }
    fn text(&mut self, b: &Value) -> Result<usize> {
        let mut parts = vec![];
        self.text_parts(b, &mut parts, 0)?;
        let index = self.program.texts.len();
        self.program.texts.push(parts);
        Ok(index)
    }
    fn text_parts(&mut self, b: &Value, parts: &mut Vec<TextPart>, depth: usize) -> Result<()> {
        ensure!(depth < 128, "text nesting exceeds 128");
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
                for (_, value) in inputs {
                    self.text_parts(value, parts, depth + 1)?;
                }
            }
            _ => parts.push(TextPart::Value(self.value(b)?)),
        }
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
    fn expr(&mut self, block: &Value) -> Result<Expr> {
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
    fn expression(&mut self, b: &Value, depth: usize) -> Result<()> {
        ensure!(depth < 128, "expression nesting exceeds 128");
        let kind = b["type"].as_str().unwrap_or("");
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
            "random_num" => {
                self.expression(input(b, "A")?, depth + 1)?;
                self.expression(input(b, "B")?, depth + 1)?;
                ExprOp::Random
            }
            "text"
            | "text_join"
            | "text_select"
            | "convert_type"
            | "self_listen_value"
            | "procedures_2_parameter"
            | "received_broadcast"
            | "text_contain"
            | "list_index_of"
            | "list_is_exist" => ExprOp::Value(self.value(b)?),
            "logic_compare" | "logic_operation" | "logic_negate" => ExprOp::Value(self.value(b)?),
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
            "list_item" => {
                let list = self.list(input(b, "list")?)?;
                let last = field(b, "item") == "last";
                if !last {
                    self.expression(input(b, "list_index")?, depth + 1)?;
                }
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
            "math_arithmetic" | "math_modulo" => {
                self.expression(input(b, "A")?, depth + 1)?;
                self.expression(input(b, "B")?, depth + 1)?;
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
            "math_function" | "math_round" | "math_trig" => {
                self.expression(
                    input(
                        b,
                        if kind == "logic_negate" {
                            "logic"
                        } else {
                            "num"
                        },
                    )?,
                    depth + 1,
                )?;
                let name = if kind == "logic_negate" {
                    "not"
                } else {
                    field(b, "type")
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
                    _ => bail!("unsupported unary operator {name}"),
                })
            }
            _ => bail!("unsupported expression {kind} at block {}", b["id"]),
        };
        self.expression_work.push(op);
        Ok(())
    }
    fn scripts(&mut self, owner: &Value, actor: usize) -> Result<()> {
        for root in owner["nekoBlockJsonList"].as_array().into_iter().flatten() {
            let kind = root["type"].as_str().unwrap_or("");
            let event = match kind {
                "self_listen" | "self_listen_with_param" => ScriptEvent::Broadcast(
                    self.value(input(root, "message")?)?,
                    kind == "self_listen_with_param",
                ),
                "on_running_group_activated" => ScriptEvent::Start,
                "on_keydown" => {
                    ensure!(
                        matches!(field(root, "type"), "down" | "up"),
                        "unknown key state at {}",
                        root["id"]
                    );
                    ScriptEvent::Key(field(root, "key").into(), field(root, "type") == "down")
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
                        id if self.actor_ids.iter().any(|a| a == id) => id.into(),
                        id => bail!("unknown pointer target {id} at {}", root["id"]),
                    };
                    ScriptEvent::Pointer(target, state.into())
                }
                // Loose workspace stacks/reporters are not executable scripts. Unknown
                // event hats must still be diagnosed, not silently discarded.
                _ if root["is_output"] == true
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
            let body = if matches!(event, ScriptEvent::Broadcast(_, _)) {
                root["statements"].get("DO")
            } else {
                root.get("next")
            };
            self.chain(body, false)
                .with_context(|| format!("owner {}", owner["name"]))?;
            self.emit(Op::Halt, root);
            self.program.scripts.push(Script {
                start,
                actor,
                event,
            });
        }
        Ok(())
    }
    fn actor_target(&self, id: &str) -> Result<usize> {
        if matches!(id, "--self" | "") {
            return Ok(usize::MAX);
        }
        if id == self.program.scene {
            return Ok(0);
        }
        self.actor_ids
            .iter()
            .position(|a| a == id)
            .map(|i| i + 1)
            .with_context(|| format!("unknown actor target {id}"))
    }
    fn chain(&mut self, mut block: Option<&Value>, warped: bool) -> Result<()> {
        self.depth += 1;
        ensure!(self.depth <= 128, "statement nesting exceeds 128");
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
                        let zero = self
                            .expr(&serde_json::json!({"type":"math_number","fields":{"NUM":0}}))?;
                        self.emit(Op::SetLocal(local, zero), b);
                    }
                    block = b.get("next");
                    continue;
                }
                "variables_set" => {
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
                    ) {
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
                    ensure!(
                        !self.lists.contains_key(field(b, "variable")),
                        "list used as scalar at {}",
                        b["id"]
                    );
                    let target = self.target(field(b, "variable"));
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
                "self_set_effect" => {
                    ensure!(
                        field(b, "scope") == "1",
                        "unsupported sprite effect {} at {}",
                        field(b, "scope"),
                        b["id"]
                    );
                    Op::Opacity(self.arg(b, "value")?)
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
                "self_set_pen_color" => {
                    let color = field(b, "color").trim_start_matches('#');
                    ensure!(color.len() == 6, "expected RGB hex color");
                    let n = u32::from_str_radix(color, 16)?;
                    Op::Color([
                        ((n >> 16) & 255) as f32 / 255.0,
                        ((n >> 8) & 255) as f32 / 255.0,
                        (n & 255) as f32 / 255.0,
                        1.0,
                    ])
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
                "procedures_2_callnoreturn" => {
                    let id = crate::runtime::helpers::procedure_def_id(b)
                        .context("procedure call has no definition ID")?;
                    let base = *self
                        .procedures
                        .get(id)
                        .with_context(|| format!("unknown statement procedure {id}"))?;
                    let params = self.procedure_params[&base].clone();
                    let args = params
                        .iter()
                        .map(|(id, _)| self.value(input(b, id)?))
                        .collect::<Result<Vec<_>>>()?;
                    ensure!(
                        b["inputs"].as_object().is_none_or(|inputs| inputs
                            .keys()
                            .all(|key| params.iter().any(|(id, _)| id == key))),
                        "unknown procedure call input at {}",
                        b["id"]
                    );
                    let index = self.program.call_arguments.len();
                    self.program.call_arguments.push(args);
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
                    self.chain(b.get("statements").and_then(|s| s.get("DO")), true)?;
                    block = b.get("next");
                    continue;
                }
                "controls_if" => {
                    let condition = self.condition(input(b, "IF0")?)?;
                    let branch = self.emit(Op::Branch(condition, 0), b);
                    self.chain(b["statements"].get("DO0"), warped)?;
                    let jump = self.emit(Op::Jump(0), b);
                    self.program.ops[branch] = Op::Branch(condition, self.program.ops.len());
                    self.chain(b["statements"].get("ELSE"), warped)?;
                    self.program.ops[jump] = Op::Jump(self.program.ops.len());
                    block = b.get("next");
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
                    self.chain(b["statements"].get("DO"), warped)?;
                    if kind == "repeat_n_times" {
                        self.emit(Op::Next(begin + 1, !warped), b);
                    } else {
                        if !warped {
                            self.emit(Op::Yield, b);
                        }
                        self.emit(Op::Jump(begin), b);
                    }
                    let end = self.program.ops.len();
                    if kind == "repeat_n_times"
                        && let Op::Repeat(n, _) = self.program.ops[begin]
                    {
                        self.program.ops[begin] = Op::Repeat(n, end);
                    }
                    if kind == "repeat_forever_until" {
                        self.program.ops[begin + 1] = Op::Jump(end);
                    }
                    for pc in self.loops.pop().unwrap() {
                        self.program.ops[pc] =
                            Op::Break(end, if kind == "repeat_n_times" { 1 } else { 0 });
                    }
                    block = b.get("next");
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
                    let by = self.arg(b, "by")?;
                    let spec = self.program.ranges.len();
                    self.program.ranges.push(RangeSpec { from, to, by });
                    let begin = self.emit(Op::Range(spec, 0), b);
                    self.ranges.push(field(param, "TEXT").into());
                    self.loops.push(vec![]);
                    self.chain(b["statements"].get("DO"), warped)?;
                    self.emit(Op::RangeNext(begin + 1, !warped), b);
                    let end = self.program.ops.len();
                    self.program.ops[begin] = Op::Range(spec, end);
                    for pc in self.loops.pop().unwrap() {
                        self.program.ops[pc] = Op::Break(end, 2);
                    }
                    self.ranges.pop();
                    block = b.get("next");
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
        self.depth -= 1;
        Ok(())
    }
}

#[derive(Clone)]
struct Task {
    id: u64,
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
}
impl Task {
    fn new(id: u64, script: &Script, locals: usize) -> Self {
        Self {
            id,
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
            locals: vec![0.0; locals],
            local_values: vec![None; locals],
        }
    }
}
#[derive(Clone)]
struct CallFrame {
    pc: usize,
    parameters: Vec<Cell>,
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
#[derive(Clone, Debug, Serialize)]
pub struct AudioCommand {
    pub audio: Cell,
    pub play: bool,
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
    /// Packed capsule instances: x1,y1,x2,y2,width,r,g,b,a. Only NEW strokes.
    #[serde(skip)]
    pub lines: Vec<f32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub text_stamps: Vec<TextStamp>,
    pub clear: bool,
    pub active: usize,
    pub instructions: usize,
    /// Scheduler ticks run for this frame (more than 1 only when coalescing).
    pub ticks: usize,
    pub execute_us: u128,
    pub budget_yield: bool,
}
pub struct Engine {
    pub program: Program,
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
    dirty: Vec<bool>,
    reset: bool,
    value_error: Option<String>,
    stopped: bool,
}
impl Engine {
    pub fn active_tasks(&self) -> usize {
        self.tasks.iter().filter(|t| !t.done).count()
    }
    pub fn numeric_variables(&self) -> &[f64] {
        &self.slots
    }
    pub fn numeric_lists(&self) -> Vec<Vec<f64>> {
        self.lists
            .iter()
            .map(|l| l.borrow().iter().map(Cell::number).collect())
            .collect()
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
    pub fn new(program: Program) -> Self {
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
        let dirty = vec![true; sprites.len()];
        Self {
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
            dirty,
            reset: true,
            value_error: None,
            stopped: false,
        }
    }
    pub fn start(&mut self) {
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
        self.pressed.clear();
        self.released.clear();
        self.mouse = [0.0; 2];
        self.pen_layer = 0;
        self.timer_visible = false;
        self.sprites.clone_from(&self.program.sprites);
        self.tasks.clear();
        self.next_task_id = 0;
        self.received.clear();
        self.value_error = None;
        self.stopped = false;
        self.time = 0.0;
        self.timer = 0.0;
        self.timer_running = true;
        self.clear = true;
        self.lines.clear();
        self.text_stamps.clear();
        self.logs.clear();
        self.audio_commands.clear();
        self.dirty.fill(true);
        self.reset = true;
        self.cursor = 0;
        self.dispatch(|event| matches!(event, ScriptEvent::Start));
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
        self.dispatch(|event| matches!(event, ScriptEvent::Key(k,d) if (k == key || k == "any") && *d == down));
    }
    pub fn set_mouse(&mut self, x: f64, y: f64) {
        if x.is_finite() && y.is_finite() {
            self.mouse = [x, y];
        }
    }
    pub fn pointer_event(&mut self, target: &str, state: &str, x: f64, y: f64) {
        self.set_mouse(x, y);
        let visible = self
            .sprites
            .iter()
            .any(|sprite| sprite.id == target && sprite.visible);
        self.dispatch(|event| matches!(event, ScriptEvent::Pointer(id,s) if s == state && (id == "--screen" || (visible && id == target))));
    }
    fn dispatch(&mut self, matches: impl Fn(&ScriptEvent) -> bool) {
        if self.stopped {
            return;
        }
        for script in &self.program.scripts {
            if self.tasks.len() >= 4096 {
                break;
            }
            if matches(&script.event) {
                self.tasks.push(Task::new(
                    self.next_task_id,
                    script,
                    self.program.local_count,
                ));
                self.next_task_id += 1;
            }
        }
    }
    fn broadcast(
        &mut self,
        message: String,
        payload: Cell,
        wait: bool,
        ready: &mut VecDeque<usize>,
    ) -> Result<()> {
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
            if self.eval_value(value, script.actor).text() != message {
                continue;
            }
            ensure!(self.tasks.len() < 4096, "broadcast task limit exceeded");
            let mut task = Task::new(self.next_task_id, &script, self.program.local_count);
            self.next_task_id += 1;
            if with_param {
                task.payload = payload.clone();
            }
            if wait {
                task.waiter = Some(self.tasks[parent].id);
                self.tasks[parent].pending += 1;
            }
            ready.push_back(self.tasks.len());
            self.tasks.push(task);
        }
        Ok(())
    }
    fn finish_task(&mut self, index: usize, ready: &mut VecDeque<usize>) {
        if self.tasks[index].done {
            return;
        }
        self.tasks[index].done = true;
        if let Some(id) = self.tasks[index].waiter.take()
            && let Some(parent) = self
                .tasks
                .iter()
                .position(|task| task.id == id && !task.done)
        {
            self.tasks[parent].pending -= 1;
            if self.tasks[parent].pending == 0 && !ready.contains(&parent) {
                ready.push_back(parent);
            }
        }
    }
    #[inline]
    fn eval(&mut self, expr: Expr, actor: usize) -> f64 {
        self.operand(expr.end as usize - 1, actor)
    }
    /// Evaluates the postfix subtree rooted at `pc`, left operand first. Kept small:
    /// numeric leaves and arithmetic stay here, everything else is out of line.
    fn node(&mut self, pc: usize, actor: usize) -> f64 {
        match self.program.expressions[pc] {
            ExprOp::Constant(n) => n,
            ExprOp::Slot(s) => self.slots[s],
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
            ExprOp::Local(s) => self.tasks[self.current_task].locals[s],
            ExprOp::Value(i) => self.eval_value(i, actor).number(),
            ExprOp::Truth(i) => u8::from(self.eval_value(i, actor).truth()) as f64,
            _ => self.node_slow(pc, actor),
        }
    }
    #[inline(always)]
    fn operand(&mut self, pc: usize, actor: usize) -> f64 {
        match self.program.expressions[pc] {
            ExprOp::Constant(n) => n,
            ExprOp::Slot(s) => self.slots[s],
            _ => self.node(pc, actor),
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
                if y {
                    self.sprites[target].y
                } else {
                    self.sprites[target].x
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
            ExprOp::Random => {
                let right = pc - 1;
                let left = self.program.expression_starts[right] as usize - 1;
                let a = (self.node(left, actor) + 0.5).floor();
                let b = (self.node(right, actor) + 0.5).floor();
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
                self.resolve_list(i).map_or(f64::NAN, |v| {
                    let values = v.borrow();
                    let at = match at {
                        None => values.len().checked_sub(1),
                        Some(at) => list_index(at),
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
            self.value_error = Some("list operation received a non-list value".into());
            None
        }
    }
    fn eval_value(&mut self, i: usize, actor: usize) -> Cell {
        // Only strings/list references are cloned; numeric expressions stay unboxed.
        match self.program.values[i] {
            ValueExpr::Number(e) => Cell::Number(self.eval(e, actor)),
            ValueExpr::Constant(v) => self.program.constants[v].clone(),
            ValueExpr::Global(i) => self.global_value(i),
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
            ValueExpr::Item(r, e) => {
                let at = e.map(|e| self.eval(e, actor));
                self.resolve_list(r).map_or(Cell::Null, |v| {
                    let v = v.borrow();
                    let at = at.map_or_else(|| v.len().checked_sub(1), list_index);
                    at.and_then(|i| v.get(i))
                        .cloned()
                        .unwrap_or(Cell::Number(f64::NAN))
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
                    self.eval_value(part, actor).append_text(&mut text);
                }
                Cell::Text(text.into())
            }
            ValueExpr::Convert(i, number) => {
                let v = self.eval_value(i, actor);
                if number {
                    Cell::Number(v.number())
                } else {
                    Cell::Text(v.text().into())
                }
            }
            ValueExpr::Not(i) => Cell::Bool(!self.eval_value(i, actor).truth()),
            ValueExpr::Logic(a, b, and) => {
                let a = self.eval_value(a, actor);
                let b = self.eval_value(b, actor);
                if a.truth() == and { b } else { a }
            }
            ValueExpr::Select(i, start, end) => {
                let text = self.eval_value(i, actor).text();
                let start = self.eval(start, actor);
                let end = self.eval(end, actor);
                let units = text.encode_utf16().collect::<Vec<_>>();
                let (start, end) = (start.floor(), end.floor());
                let clamp = |n: f64| (n.max(0.0) as usize).min(units.len());
                let selected = if start <= end - 1.0 {
                    units[clamp(start - 1.0)..clamp(end)].to_vec()
                } else {
                    units[clamp(end - 1.0)..clamp(start)]
                        .iter()
                        .rev()
                        .copied()
                        .collect()
                };
                Cell::Text(String::from_utf16_lossy(&selected).into())
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
    fn eval_text(&mut self, text: usize, actor: usize) -> String {
        let mut value = String::new();
        for i in 0..self.program.texts[text].len() {
            match self.program.texts[text][i] {
                TextPart::Literal(index) => value.push_str(&self.program.strings[index]),
                TextPart::Value(i) => self.eval_value(i, actor).append_text(&mut value),
            }
        }
        value
    }
    fn line(&mut self, actor: usize, old: (f64, f64)) {
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
                || self.clear
                || self.reset
                || self.pen_layer != layer
                || self.dirty.iter().any(|d| *d);
            let runnable = self
                .tasks
                .iter()
                .any(|t| !t.done && t.pending == 0 && t.wake <= self.time);
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
        let sprites = self
            .sprites
            .iter()
            .zip(&mut self.dirty)
            .filter_map(|(a, dirty)| {
                if std::mem::take(dirty) {
                    Some(a.clone())
                } else {
                    None
                }
            })
            .collect();
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
            logs: std::mem::take(&mut self.logs),
            audio_commands: std::mem::take(&mut self.audio_commands),
            clear: std::mem::take(&mut self.clear),
            active: self.tasks.len(),
            instructions: count,
            ticks,
            execute_us,
            budget_yield: exceeded,
        })
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
        self.time += dt;
        if self.timer_running {
            self.timer += dt;
        }
        self.received.clear();
        let mut count = *total_count;
        let mut exceeded = false;
        let total = self.tasks.len();
        let mut ready = (0..total)
            .map(|i| (self.cursor + i) % total)
            .collect::<VecDeque<_>>();
        while let Some(index) = ready.pop_front() {
            if self.tasks[index].done
                || self.tasks[index].pending > 0
                || self.tasks[index].wake > self.time
            {
                continue;
            }
            let actor = self.tasks[index].actor;
            self.current_task = index;
            loop {
                if count >= max_instructions
                    || (count.is_multiple_of(256) && started.elapsed() >= budget)
                    || self.lines.len() >= 9 * 65536
                    || self.text_stamps.len() >= 1024
                    || self.audio_commands.len() >= 1024
                {
                    exceeded = true;
                    self.cursor = (index + 1) % self.tasks.len();
                    break;
                }
                let pc = self.tasks[index].pc;
                let op = self.program.ops[pc];
                self.tasks[index].pc += 1;
                count += 1;
                let moves = matches!(
                    op,
                    Op::Move(_)
                        | Op::Position(_, _)
                        | Op::X(_)
                        | Op::Y(_)
                        | Op::AddX(_)
                        | Op::AddY(_)
                        | Op::Pen(true)
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
                    )
                {
                    self.dirty[actor] = true;
                }
                match op {
                    Op::Set(s, e) => {
                        self.slots[s] = self.eval(e, actor);
                        self.values[s] = None;
                    }
                    Op::Change(s, e, sign) => {
                        self.slots[s] += self.eval(e, actor) * sign;
                        self.values[s] = None;
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
                        let a = &mut self.sprites[actor];
                        let (sin, cos) = a.direction.to_radians().sin_cos();
                        a.x += n * sin;
                        a.y += n * cos;
                        self.line(actor, old);
                    }
                    Op::Position(x, y) => {
                        let x = self.eval(x, actor);
                        let y = self.eval(y, actor);
                        self.sprites[actor].x = x;
                        self.sprites[actor].y = y;
                        self.line(actor, old);
                    }
                    Op::X(e) => {
                        self.sprites[actor].x = self.eval(e, actor);
                        self.line(actor, old);
                    }
                    Op::Y(e) => {
                        self.sprites[actor].y = self.eval(e, actor);
                        self.line(actor, old);
                    }
                    Op::AddX(e) => {
                        self.sprites[actor].x += self.eval(e, actor);
                        self.line(actor, old);
                    }
                    Op::AddY(e) => {
                        self.sprites[actor].y += self.eval(e, actor);
                        self.line(actor, old);
                    }
                    Op::Turn(e) => self.sprites[actor].direction += self.eval(e, actor),
                    Op::Direction(e) => self.sprites[actor].direction = self.eval(e, actor),
                    Op::Scale(e) => self.sprites[actor].scale = self.eval(e, actor),
                    Op::Visible(v) => self.sprites[actor].visible = v,
                    Op::Style(value) => {
                        let value = self.eval_value(value, actor);
                        let styles = &self.sprites[actor].styles;
                        let selected = match value {
                            Cell::Text(id) => styles.iter().find(|s| s.as_str() == id.as_ref()),
                            Cell::Number(n) if n.is_finite() && (n + 0.5).floor() >= 1.0 => {
                                styles.get(((n + 0.5).floor() - 1.0) as usize)
                            }
                            _ => None,
                        }
                        .with_context(|| {
                            format!(
                                "invalid costume for {} at block {}",
                                self.sprites[actor].id, self.program.sources[pc]
                            )
                        })?
                        .clone();
                        self.sprites[actor].style = Some(selected);
                    }
                    Op::NextStyle(next) => {
                        let sprite = &mut self.sprites[actor];
                        if !sprite.styles.is_empty() {
                            let current = sprite
                                .styles
                                .iter()
                                .position(|id| Some(id) == sprite.style.as_ref())
                                .unwrap_or(0);
                            let offset = if next { 1 } else { sprite.styles.len() - 1 };
                            sprite.style = Some(
                                sprite.styles[(current + offset) % sprite.styles.len()].clone(),
                            );
                        }
                    }
                    Op::Opacity(value) => {
                        let transparency = self.eval(value, actor);
                        if transparency.is_finite() {
                            self.sprites[actor].opacity =
                                1.0 - transparency.clamp(0.0, 100.0) / 100.0;
                        }
                    }
                    Op::PenLayer(layer) => {
                        if actor != 0 {
                            let count = self.sprites.len() - 1;
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
                            let at = at.map_or_else(|| list.len().checked_sub(1), list_index);
                            if let Some(at) = at.filter(|i| *i < list.len()) {
                                list.remove(at);
                            }
                        }
                    }
                    Op::InsertList(list, e, value) => {
                        let at = list_index(self.eval(e, actor));
                        let value = self.eval_value(value, actor);
                        if let (Some(at), Some(list)) = (at, self.resolve_list(list)) {
                            ensure!(
                                !contains_list(&value, &list),
                                "cyclic list at {}",
                                self.program.sources[pc]
                            );
                            let mut list = list.borrow_mut();
                            let at = at.min(list.len());
                            list.insert(at, value);
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
                            let at =
                                at.map_or_else(|| Some(list.len().saturating_sub(1)), list_index);
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
                        if actor != 0 && size.is_finite() {
                            let text = self.eval_text(text, actor);
                            let a = &self.sprites[actor];
                            self.text_stamps.push(TextStamp {
                                before_line: self.lines.len() / 9,
                                text,
                                x: a.x,
                                y: a.y,
                                size: size.clamp(1.0, 1000.0),
                                direction: a.direction,
                                align,
                                color: a.color,
                            });
                        }
                    }
                    Op::Size(e) => {
                        self.sprites[actor].size = self.eval(e, actor).clamp(1.0, 1000.0)
                    }
                    Op::Clear => {
                        self.lines.clear();
                        self.text_stamps.clear();
                        self.clear = true;
                    }
                    Op::Branch(e, target) => {
                        if !truth(self.eval(e, actor)) {
                            self.tasks[index].pc = target;
                        }
                    }
                    Op::Jump(target) => self.tasks[index].pc = target,
                    Op::Yield => break,
                    Op::Wait(e) => {
                        self.tasks[index].wake = self.time + self.eval(e, actor).max(0.0);
                        break;
                    }
                    Op::Repeat(e, end) => {
                        let n = self.eval(e, actor).floor().clamp(0.0, u32::MAX as f64) as u64;
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
                                break;
                            }
                        } else {
                            self.tasks[index].loops.pop();
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
                                && (by + 0.5).floor() > 0.0,
                            "range requires finite endpoints and positive rounded step at {}",
                            self.program.sources[pc]
                        );
                        let value = if from <= to {
                            from.ceil()
                        } else {
                            from.floor()
                        };
                        let step = (by + 0.5).floor() * if from <= to { 1.0 } else { -1.0 };
                        if (step > 0.0 && value > to) || (step < 0.0 && value < to) {
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
                            next != range.value,
                            "range step makes no progress at {}",
                            self.program.sources[pc]
                        );
                        range.value = next;
                        if (range.step > 0.0 && next <= range.end)
                            || (range.step < 0.0 && next >= range.end)
                        {
                            self.tasks[index].pc = target;
                            if yielding {
                                break;
                            }
                        } else {
                            self.tasks[index].ranges.pop();
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
                        self.audio_commands.push(AudioCommand { audio, play });
                    }
                    Op::LogNumber(e) => {
                        let n = self.eval(e, actor);
                        if self.logs.len() < 1024 {
                            self.logs.push(n.to_string());
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
                            break;
                        }
                    }
                    Op::Broadcast(message, payload, wait) => {
                        let message = self.eval_value(message, actor).text();
                        let payload =
                            payload.map_or(Cell::Number(f64::NAN), |i| self.eval_value(i, actor));
                        self.broadcast(message, payload, wait, &mut ready)?;
                        if self.tasks[index].pending > 0 {
                            break;
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
                                self.finish_task(target, &mut ready);
                            }
                        }
                        if self.tasks[index].done {
                            break;
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
                        });
                        task.pc = self.program.procedure_entries[procedure];
                    }
                    Op::Return => {
                        let call = self.tasks[index]
                            .calls
                            .pop()
                            .context("invalid procedure return")?;
                        self.tasks[index].pc = call.pc;
                        self.tasks[index].parameters = call.parameters;
                    }
                    Op::Halt => {
                        self.finish_task(index, &mut ready);
                        break;
                    }
                }
                if self.value_error.is_some() {
                    let error = self.value_error.take().unwrap_or_default();
                    bail!("{error} at block {}", self.program.sources[pc]);
                }
                if moves
                    && (!self.sprites[actor].x.is_finite() || !self.sprites[actor].y.is_finite())
                {
                    bail!("non-finite position at block {}", self.program.sources[pc]);
                }
            }
            if exceeded {
                break;
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
        *total_count = count;
        Ok(exceeded)
    }
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
