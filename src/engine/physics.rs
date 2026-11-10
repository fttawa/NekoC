//! Kitten 4 rigid bodies. Official source anchors and deliberate solver/shape
//! differences are documented in docs/kitten4-physics.md. No HateNeko code.
use super::{Engine, Sprite, field};
use anyhow::{Result, bail, ensure};
use rapier2d_f64::prelude::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const STEP: f64 = 1.0 / 60.0;
const PIXELS: f64 = 10.0;
const HOOKS: ActiveHooks = ActiveHooks::FILTER_CONTACT_PAIRS
    .union(ActiveHooks::FILTER_INTERSECTION_PAIR)
    .union(ActiveHooks::MODIFY_SOLVER_CONTACTS);

#[derive(Clone, Copy, Debug)]
pub(super) enum Property {
    Speed,
    Direction,
    Mass,
    Friction,
    Restitution,
    Flexibility,
}
impl Property {
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "speed" => Self::Speed,
            "speed_dir" => Self::Direction,
            "mass" => Self::Mass,
            "friction" => Self::Friction,
            "restitution" => Self::Restitution,
            "flexibility" => Self::Flexibility,
            _ => bail!("unknown physics property {value}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        engine::{Costume, Program},
        studio::document::Document,
    };

    fn engine() -> Engine {
        let p = Document::blank();
        let mut e = Engine::new(Program::compile(p.value()).unwrap());
        e.start();
        e
    }
    fn command(e: &mut Engine, actor: usize, c: Command, values: [f64; 3]) {
        e.physics_command(actor, c, values).unwrap();
    }

    #[test]
    fn ordinary_projects_do_not_allocate_physics_and_restart_discards_world() {
        let mut e = engine();
        e.step_physics(STEP);
        assert!(e.physics.is_none());
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        assert_eq!(e.physics.as_ref().unwrap().worlds.len(), 1);
        e.start();
        assert!(e.physics.is_none());
    }

    #[test]
    fn legacy_velocity_does_not_allocate_and_checks_finite_before_scene_error() {
        let mut e = engine();
        command(&mut e, 1, Command::LegacyVelocity, [99.0, 0.0, 0.0]);
        assert!(e.physics.is_none());
        command(&mut e, 0, Command::LegacyVelocity, [f64::NAN, 0.0, 0.0]);
        assert!(e.physics.is_none());
        assert!(
            e.physics_command(0, Command::LegacyVelocity, [1.0, 0.0, 0.0])
                .is_err()
        );
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocity, [2.0, 90.0, 0.0]);
        let y = e.sprites[1].y;
        e.step_physics(STEP);
        assert!((e.sprites[1].y - y - 200.0 * STEP).abs() < 0.001);
        assert_eq!(e.physics_property(1, Property::Speed), 2.0);
        command(&mut e, 1, Command::LegacyVelocity, [20000.0, 0.0, 0.0]);
        assert_eq!(e.physics_property(1, Property::Speed), 10000.0);
    }

    #[test]
    fn sensor_static_hidden_and_repeated_enable_preserve_velocity() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::Speed, [2.0, 0.0, 0.0]);
        command(&mut e, 1, Command::Collidable(false), [0.0; 3]);
        command(&mut e, 1, Command::Forceable(true), [0.0; 3]);
        let x = e.sprites[1].x;
        e.step_physics(STEP);
        assert!(e.sprites[1].x > x);
        command(&mut e, 1, Command::Forceable(false), [0.0; 3]);
        let x = e.sprites[1].x;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x);
        assert_eq!(e.physics_property(1, Property::Speed), 2.0);
        command(&mut e, 1, Command::Forceable(true), [0.0; 3]);
        e.sprites[1].visible = false;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x);
        e.sprites[1].visible = true;
        e.step_physics(STEP);
        assert!(e.sprites[1].x > x);
    }

    #[test]
    fn mask_and_size_changes_rebuild_shape_and_clone_deletion_removes_body() {
        let mut e = engine();
        let id = e.sprites[1].style.clone().unwrap();
        e.set_costume(
            &id,
            Costume {
                width: 20.0,
                height: 20.0,
                ..Default::default()
            },
        );
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        let full = e.physics_property(1, Property::Mass);
        e.set_costume(
            &id,
            Costume {
                width: 20.0,
                height: 20.0,
                mask: Some((2, 2, vec![0b0101])),
                rgb: None,
                center_point: [0.0; 2],
            },
        );
        e.step_physics(STEP);
        assert!((e.physics_property(1, Property::Mass) - full / 2.0).abs() < 0.01);
        e.sprites[1].scale *= 2.0;
        e.step_physics(STEP);
        assert!((e.physics_property(1, Property::Mass) - full * 2.0).abs() < 0.01);
        e.clone_sprite(1, None).unwrap();
        let clone = e.sprites.len() - 1;
        command(&mut e, clone, Command::Speed, [1.0, 0.0, 0.0]);
        let scene = e.sprites[clone].scene;
        assert_eq!(e.physics.as_ref().unwrap().worlds[&scene].actors.len(), 2);
        e.delete_clone(clone);
        let w = &e.physics.as_ref().unwrap().worlds[&scene];
        assert_eq!(w.actors.len(), 1);
        assert_eq!(w.bodies.len(), 1);
        assert_eq!(w.colliders.len(), 1);
    }

    #[test]
    fn either_actor_can_own_an_exclusion_and_reenable_restores_contacts() {
        let mut e = engine();
        let id = e.sprites[1].style.clone().unwrap();
        e.set_costume(
            &id,
            Costume {
                width: 20.0,
                height: 20.0,
                ..Default::default()
            },
        );
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        e.clone_sprite(1, None).unwrap();
        let other = e.sprites.len() - 1;
        command(&mut e, other, Command::Forceable(false), [0.0; 3]);
        command(&mut e, 1, Command::Filter(1, false), [0.0; 3]);
        command(&mut e, other, Command::Filter(1, false), [0.0; 3]);
        command(&mut e, 1, Command::Filter(1, true), [0.0; 3]);
        e.step_physics(STEP);
        assert_eq!(e.physics_touching(1, other), Some(false));
        command(&mut e, other, Command::Filter(1, true), [0.0; 3]);
        e.step_physics(STEP);
        assert_eq!(e.physics_touching(1, other), Some(true));
    }
}
#[derive(Clone, Copy, Debug)]
pub(super) enum Command {
    Forceable(bool),
    Collidable(bool),
    Rotate(bool),
    Boundary(u8),
    Filter(usize, bool),
    Gravity,
    Speed,
    LegacyVelocity,
    Force,
    TimedForce,
    Mass,
    Friction,
    Restitution,
    Hard,
    Soft,
    Flexibility,
}
impl Command {
    pub fn parse(kind: &str, b: &Value, target: impl Fn(&str) -> Result<usize>) -> Result<Self> {
        Ok(match kind {
            "physics2_enable_force" => Self::Forceable(field(b, "is_enable") == "true"),
            "physics2_set_actor_as" => {
                Self::Collidable(field(b, "physics_body_type") == "attend_physics_world")
            }
            "physics2_allow_rotate" => Self::Rotate(field(b, "is_allow") == "true"),
            "physics2_set_boundary" => Self::Boundary(match field(b, "physics_bound_type") {
                "not_bound" => 0,
                "all_bounds" => 15,
                "bottom_bound" => 2,
                "left_right_bottom_bounds" => 14,
                other => bail!("unknown physics boundary {other}"),
            }),
            "physics2_forbid_bump_with" => {
                let id = field(b, "sprite");
                Self::Filter(
                    super::edge_target(id)
                        .map(Ok)
                        .unwrap_or_else(|| target(id))?,
                    field(b, "is_bump") == "true",
                )
            }
            "physics2_set_gravity" => Self::Gravity,
            "physics2_set_speed" => Self::Speed,
            "physics2_set_force" => Self::Force,
            "physics2_set_force_in_time" => Self::TimedForce,
            "physics2_set_mass" => Self::Mass,
            "physics2_set_roughness" => Self::Friction,
            "physics2_set_resilience" => Self::Restitution,
            "physics2_set_texture" => {
                if field(b, "texture_type") == "soft" {
                    Self::Soft
                } else {
                    Self::Hard
                }
            }
            "physics2_set_flexibility" => Self::Flexibility,
            _ => bail!("unsupported physics block {kind}"),
        })
    }
}

struct Body {
    handle: RigidBodyHandle,
    collider: ColliderHandle,
    forceable: bool,
    collidable: bool,
    rotate: bool,
    shape: (Option<String>, f64, f64),
    forces: Vec<(u64, Vector<f64>)>,
    saved_velocity: Vector<f64>,
}
#[derive(Default)]
struct Filters(BTreeSet<(usize, usize)>);
impl PhysicsHooks for Filters {
    fn modify_solver_contacts(&self, context: &mut ContactModificationContext<'_>) {
        // Box2D mixes friction geometrically; Rapier's Multiply rule alone
        // would make the surface substantially too slippery.
        let a = &context.colliders[context.collider1];
        let b = &context.colliders[context.collider2];
        for contact in context.solver_contacts.iter_mut() {
            contact.friction = (a.friction() * b.friction()).sqrt();
        }
    }
    fn filter_contact_pair(&self, context: &PairFilterContext<'_>) -> Option<SolverFlags> {
        let a = context.colliders[context.collider1].user_data as usize;
        let b = context.colliders[context.collider2].user_data as usize;
        (!self.0.contains(&(a, b)) && !self.0.contains(&(b, a)))
            .then_some(SolverFlags::COMPUTE_IMPULSES)
    }
    fn filter_intersection_pair(&self, context: &PairFilterContext<'_>) -> bool {
        self.filter_contact_pair(context).is_some()
    }
}
struct World {
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad: BroadPhaseMultiSap,
    narrow: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    impulse: ImpulseJointSet,
    multibody: MultibodyJointSet,
    ccd: CCDSolver,
    actors: BTreeMap<usize, Body>,
    edges: BTreeMap<usize, ColliderHandle>,
    gravity: Vector<f64>,
    filters: Filters,
    remainder: f64,
}
impl Default for World {
    fn default() -> Self {
        Self {
            pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(),
            broad: BroadPhaseMultiSap::new(),
            narrow: NarrowPhase::new(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            impulse: ImpulseJointSet::new(),
            multibody: MultibodyJointSet::new(),
            ccd: CCDSolver::new(),
            actors: BTreeMap::new(),
            edges: BTreeMap::new(),
            gravity: vector![0.0, -100.0],
            filters: Filters::default(),
            remainder: 0.0,
        }
    }
}
#[derive(Default)]
pub(super) struct Physics {
    worlds: BTreeMap<usize, World>,
}

fn geometry(engine: &Engine, actor: usize) -> SharedShape {
    let sprite = &engine.sprites[actor];
    let costume = sprite
        .style
        .as_ref()
        .and_then(|id| engine.program.costumes.get(id));
    let (w, h) = costume.map_or((1.0, 1.0), |c| (c.width, c.height));
    let sx = sprite.scale * sprite.size_x / 10000.0 / PIXELS;
    let sy = sprite.scale * sprite.size_y / 10000.0 / PIXELS;
    // Keep disconnected/concave silhouettes as a compound of opaque mask runs;
    // without a decoded mask the documented fallback is the costume rectangle.
    if let Some((mw, mh, mask)) = costume.and_then(|c| c.mask.as_ref()) {
        let mut shapes = Vec::new();
        for y in 0..*mh {
            let mut x = 0;
            while x < *mw {
                let solid = |x: usize| {
                    let bit = y * mw + x;
                    mask.get(bit / 8).is_some_and(|v| v & (1 << (bit % 8)) != 0)
                };
                if !solid(x) {
                    x += 1;
                    continue;
                }
                let start = x;
                while x < *mw && solid(x) {
                    x += 1;
                }
                let dx = w / *mw as f64;
                let dy = h / *mh as f64;
                shapes.push((
                    Isometry::translation(
                        ((start + x) as f64 * dx / 2.0 - w / 2.0) * sx,
                        (h / 2.0 - (y as f64 + 0.5) * dy) * sy,
                    ),
                    SharedShape::cuboid(
                        ((x - start) as f64 * dx * sx / 2.0).abs().max(0.001),
                        (dy * sy / 2.0).abs().max(0.001),
                    ),
                ));
            }
        }
        if !shapes.is_empty() {
            return SharedShape::compound(shapes);
        }
    }
    SharedShape::cuboid(
        (w * sx / 2.0).abs().max(0.001),
        (h * sy / 2.0).abs().max(0.001),
    )
}
fn signature(sprite: &Sprite) -> (Option<String>, f64, f64) {
    (
        sprite.style.clone(),
        sprite.scale * sprite.size_x,
        sprite.scale * sprite.size_y,
    )
}
impl Engine {
    fn ensure_physics_body(&mut self, actor: usize) {
        let scene = self.sprites[actor].scene;
        if self
            .physics
            .as_ref()
            .and_then(|p| p.worlds.get(&scene))
            .is_some_and(|w| w.actors.contains_key(&actor))
        {
            return;
        }
        let shape = geometry(self, actor);
        let a = &self.sprites[actor];
        let world = self
            .physics
            .get_or_insert_with(Default::default)
            .worlds
            .entry(scene)
            .or_default();
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![a.x / PIXELS, a.y / PIXELS])
            .rotation((90.0 - a.direction).to_radians())
            .lock_rotations()
            .build();
        let handle = world.bodies.insert(body);
        let collider = world.colliders.insert_with_parent(
            ColliderBuilder::new(shape)
                .density(0.1)
                .friction(0.1)
                .restitution(0.0)
                .restitution_combine_rule(CoefficientCombineRule::Max)
                .active_hooks(HOOKS)
                .user_data(actor as u128)
                .build(),
            handle,
            &mut world.bodies,
        );
        world.bodies[handle].recompute_mass_properties_from_colliders(&world.colliders);
        world.actors.insert(
            actor,
            Body {
                handle,
                collider,
                forceable: true,
                collidable: true,
                rotate: false,
                shape: signature(a),
                forces: vec![],
                saved_velocity: Vector::zeros(),
            },
        );
    }
    pub(super) fn physics_command(
        &mut self,
        actor: usize,
        command: Command,
        values: [f64; 3],
    ) -> Result<Option<f64>> {
        // Offline official player_v2/Bt.set_velocity: finite Numbers only,
        // no lazy body/world creation, unlike physics2_set_speed.
        let legacy = matches!(command, Command::LegacyVelocity);
        if legacy && (!values[0].is_finite() || !values[1].is_finite()) {
            return Ok(None);
        }
        ensure!(
            !self.sprites[actor].stage,
            "Kitten 4 physics blocks cannot run on a scene"
        );
        if legacy
            && !self
                .physics
                .as_ref()
                .and_then(|p| p.worlds.get(&self.sprites[actor].scene))
                .is_some_and(|w| w.actors.contains_key(&actor))
        {
            return Ok(None);
        }
        self.ensure_physics_body(actor);
        // LiquidFun particle groups have no equivalent in this rigid solver: a
        // soft actor keeps running as a rigid body so the work does not stop.
        // `coverage` lists physics2_set_flexibility as a stub.
        if matches!(command, Command::Soft | Command::Flexibility) {
            return Ok(None);
        }
        let scene = self.sprites[actor].scene;
        let world = self
            .physics
            .as_mut()
            .unwrap()
            .worlds
            .get_mut(&scene)
            .unwrap();
        let state = world.actors.get_mut(&actor).unwrap();
        let body = &mut world.bodies[state.handle];
        let [value, dir, time] = values;
        let vector = |limit: f64| {
            let r = dir.to_radians();
            vector![
                value.clamp(-limit, limit) * 10.0 * r.cos(),
                value.clamp(-limit, limit) * 10.0 * r.sin()
            ]
        };
        match command {
            Command::Forceable(enabled) => {
                let was_forceable = state.forceable;
                if state.forceable && !enabled {
                    state.saved_velocity = *body.linvel();
                }
                state.forceable = enabled;
                body.set_body_type(
                    if enabled {
                        RigidBodyType::Dynamic
                    } else {
                        RigidBodyType::Fixed
                    },
                    true,
                );
                if enabled && !was_forceable {
                    body.set_linvel(state.saved_velocity, true);
                }
            }
            Command::Collidable(enabled) => state.collidable = enabled,
            Command::Rotate(enabled) => {
                state.rotate = enabled;
                body.lock_rotations(!enabled, true);
            }
            Command::Gravity if !value.is_nan() && dir.is_finite() => {
                world.gravity = vector(10000.0)
            }
            Command::Speed if !value.is_nan() && dir.is_finite() => {
                state.saved_velocity = vector(12.0);
                body.set_linvel(state.saved_velocity, true)
            }
            Command::LegacyVelocity => {
                state.saved_velocity = vector(10000.0);
                body.set_linvel(state.saved_velocity, true)
            }
            Command::Force if dir.is_finite() => body.add_force(
                if value.is_nan() {
                    Vector::zeros()
                } else {
                    vector(10000.0)
                },
                true,
            ),
            Command::TimedForce if dir.is_finite() && time.is_finite() && time.fract() == 0.0 => {
                let ticks = (time.max(0.0) / STEP).round() as u64;
                state.forces.push((
                    ticks,
                    if value.is_nan() {
                        Vector::zeros()
                    } else {
                        vector(10000.0)
                    },
                ));
                return Ok(Some(ticks.saturating_add(1) as f64 * STEP));
            }
            Command::Friction if value.is_finite() => {
                world.colliders[state.collider].set_friction(value.clamp(0.0, 1.0))
            }
            Command::Restitution if value.is_finite() => {
                world.colliders[state.collider].set_restitution(value.clamp(0.0, 1.0))
            }
            Command::Mass if !value.is_nan() && value > 0.0 => {
                world.colliders[state.collider].set_mass(value.min(10000.0));
                body.recompute_mass_properties_from_colliders(&world.colliders);
            }
            Command::Filter(target, enabled) => {
                let targets = if target == super::TARGET_EDGE {
                    (0..4).map(|i| super::TARGET_EDGE_SIDE - i).collect()
                } else if target >= super::TARGET_EDGE_SIDE - 3 {
                    vec![target]
                } else {
                    self.sprites
                        .iter()
                        .enumerate()
                        .filter(|(_, s)| s.origin == target)
                        .map(|(i, _)| i)
                        .collect::<Vec<_>>()
                };
                for other in targets {
                    // Each actor owns its exclusion list. Enabling A -> B
                    // must not erase a separate exclusion owned by B -> A.
                    let pair = (actor, other);
                    if enabled {
                        world.filters.0.remove(&pair);
                    } else {
                        world.filters.0.insert(pair);
                    }
                }
                // Refresh existing contacts, not just newly discovered pairs.
                for (_, c) in world.colliders.iter_mut() {
                    c.set_active_hooks(HOOKS);
                    let enabled = c.is_enabled();
                    c.set_enabled(false);
                    c.set_enabled(enabled);
                }
                for (_, b) in world.bodies.iter_mut() {
                    b.wake_up(true);
                }
            }
            Command::Boundary(mask) => {
                for side in 0..4 {
                    let key = super::TARGET_EDGE_SIDE - side;
                    if mask & (1 << side) == 0 {
                        if let Some(c) = world.edges.remove(&key) {
                            world
                                .colliders
                                .remove(c, &mut world.islands, &mut world.bodies, true);
                        }
                    } else if !world.edges.contains_key(&key) {
                        let (w, h) = (
                            self.program.width / PIXELS / 2.0,
                            self.program.height / PIXELS / 2.0,
                        );
                        let (x, y) = match side {
                            0 => (0.0, h + 1000.0),
                            1 => (0.0, -h - 1000.0),
                            2 => (-w - 1000.0, 0.0),
                            _ => (w + 1000.0, 0.0),
                        };
                        let collider = ColliderBuilder::cuboid(1000.0, 1000.0)
                            .translation(vector![x, y])
                            .friction(0.1)
                            .user_data(key as u128)
                            .active_hooks(HOOKS)
                            .build();
                        world.edges.insert(key, world.colliders.insert(collider));
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }
    pub(super) fn physics_property(&mut self, actor: usize, property: Property) -> f64 {
        if self.sprites[actor].stage {
            return 0.0;
        }
        self.ensure_physics_body(actor);
        let w = &self.physics.as_ref().unwrap().worlds[&self.sprites[actor].scene];
        let b = &w.actors[&actor];
        let body = &w.bodies[b.handle];
        let value = match property {
            Property::Speed => {
                if b.forceable {
                    body.linvel()
                } else {
                    &b.saved_velocity
                }
                .norm()
                    / 10.0
            }
            Property::Direction => {
                let v = if b.forceable {
                    body.linvel()
                } else {
                    &b.saved_velocity
                };
                v.y.atan2(v.x).to_degrees()
            }
            Property::Mass => body.mass(),
            Property::Friction => w.colliders[b.collider].friction(),
            Property::Restitution => w.colliders[b.collider].restitution(),
            Property::Flexibility => 50.0,
        };
        (value * 100.0 + 0.5).floor() / 100.0
    }
    pub(super) fn step_physics(&mut self, dt: f64) {
        if self.stopped || dt <= 0.0 || self.physics.is_none() {
            return;
        }
        let mut physics = self.physics.take().unwrap();
        for (&scene, w) in &mut physics.worlds {
            if scene != self.current_scene {
                continue;
            }
            for (&actor, b) in &mut w.actors {
                let a = &self.sprites[actor];
                let body = &mut w.bodies[b.handle];
                body.set_enabled(a.alive && a.visible && (b.forceable || b.collidable));
                let position = Isometry::new(
                    vector![a.x / PIXELS, a.y / PIXELS],
                    (90.0 - a.direction).to_radians(),
                );
                if (body.position().translation.vector - position.translation.vector).norm() > 1e-8
                    || (body.rotation().angle() - position.rotation.angle()).abs() > 1e-8
                {
                    body.set_position(position, true);
                }
                if b.shape != signature(a) {
                    w.colliders[b.collider].set_shape(geometry(self, actor));
                    b.shape = signature(a);
                }
                w.colliders[b.collider].set_sensor(b.forceable && !b.collidable);
            }
            w.remainder += dt;
            while w.remainder + 1e-10 >= STEP {
                for b in w.actors.values_mut() {
                    for (ticks, force) in &mut b.forces {
                        if *ticks > 0 {
                            w.bodies[b.handle].add_force(*force, true);
                            *ticks -= 1;
                        }
                    }
                    b.forces.retain(|(ticks, _)| *ticks > 0);
                }
                w.pipeline.step(
                    &w.gravity,
                    &IntegrationParameters {
                        dt: STEP,
                        ..Default::default()
                    },
                    &mut w.islands,
                    &mut w.broad,
                    &mut w.narrow,
                    &mut w.bodies,
                    &mut w.colliders,
                    &mut w.impulse,
                    &mut w.multibody,
                    &mut w.ccd,
                    None,
                    &w.filters,
                    &(),
                );
                for b in w.actors.values() {
                    w.bodies[b.handle].reset_forces(false);
                }
                w.remainder -= STEP;
            }
            for (&actor, b) in &w.actors {
                let body = &w.bodies[b.handle];
                if !body.is_enabled() {
                    continue;
                }
                let a = &mut self.sprites[actor];
                let (x, y) = (body.translation().x * PIXELS, body.translation().y * PIXELS);
                let direction = 90.0 - body.rotation().angle().to_degrees();
                if a.x != x || a.y != y || a.direction != direction {
                    a.x = x;
                    a.y = y;
                    a.direction = direction;
                    self.dirty[actor] = true;
                }
            }
        }
        self.physics = Some(physics);
    }
    pub(super) fn remove_physics_body(&mut self, actor: usize) {
        let Some(p) = self.physics.as_mut() else {
            return;
        };
        for w in p.worlds.values_mut() {
            if let Some(b) = w.actors.remove(&actor) {
                w.bodies.remove(
                    b.handle,
                    &mut w.islands,
                    &mut w.colliders,
                    &mut w.impulse,
                    &mut w.multibody,
                    true,
                );
            }
            w.filters.0.retain(|&(a, b)| a != actor && b != actor);
        }
    }
    pub(super) fn invalidate_physics_costume(&mut self, id: &str) {
        if let Some(p) = self.physics.as_mut() {
            for w in p.worlds.values_mut() {
                for b in w.actors.values_mut() {
                    if b.shape.0.as_deref() == Some(id) {
                        b.shape.1 = f64::NAN;
                    }
                }
            }
        }
    }
    pub(super) fn physics_touching(&self, actor: usize, other: usize) -> Option<bool> {
        let w = self
            .physics
            .as_ref()?
            .worlds
            .get(&self.sprites[actor].scene)?;
        let a = w.actors.get(&actor)?;
        let hit = |c| {
            w.narrow
                .contact_pair(a.collider, c)
                .is_some_and(|p| p.has_any_active_contact)
                || w.narrow.intersection_pair(a.collider, c) == Some(true)
        };
        if other == super::TARGET_EDGE {
            return Some(w.edges.values().any(|c| hit(*c)));
        }
        if let Some(c) = w.edges.get(&other) {
            return Some(hit(*c));
        }
        let b = w.actors.get(&other)?;
        Some(hit(b.collider))
    }
}
