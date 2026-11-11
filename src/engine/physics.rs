//! Kitten 4 rigid bodies. Official source anchors and deliberate solver/shape
//! differences are documented in docs/kitten4-physics.md. No HateNeko code.
use super::{Engine, Sprite, field};
use anyhow::{Result, bail, ensure};
use rapier2d_f64::prelude::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[path = "physics_shape.rs"]
mod shape;

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
    Density,
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
            "density" => Self::Density,
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
        assert_eq!(e.sprites[1].y, y); // actor ticker precedes world integration
        e.step_physics(STEP);
        assert!((e.sprites[1].y - y - 200.0 * STEP).abs() < 0.001);
        assert_eq!(e.physics_property(1, Property::Speed), 2.0);
        command(&mut e, 1, Command::LegacyVelocity, [20000.0, 0.0, 0.0]);
        assert_eq!(e.physics_property(1, Property::Speed), 10000.0);
    }

    #[test]
    fn invalid_modern_speed_and_gravity_do_not_allocate_but_scenes_still_error() {
        for c in [Command::Speed, Command::Gravity] {
            let mut e = engine();
            command(&mut e, 1, c, [f64::NAN, 0.0, 0.0]);
            command(&mut e, 1, c, [1.0, f64::INFINITY, 0.0]);
            assert!(e.physics.is_none());
            assert!(e.physics_command(0, c, [f64::NAN, 0.0, 0.0]).is_err());
        }
    }

    #[test]
    fn disabled_sensor_and_hidden_dynamic_body_preserve_velocity() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::Speed, [2.0, 0.0, 0.0]);
        command(&mut e, 1, Command::Collidable(false), [0.0; 3]);
        command(&mut e, 1, Command::Forceable(true), [0.0; 3]);
        let x = e.sprites[1].x;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x);
        e.step_physics(STEP);
        assert!(e.sprites[1].x > x);
        command(&mut e, 1, Command::Forceable(false), [0.0; 3]);
        let x = e.sprites[1].x;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x); // disabled adapters do not publish
        assert_eq!(e.physics_property(1, Property::Speed), 2.0);
        let x = e.sprites[1].x;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x);
        command(&mut e, 1, Command::Forceable(true), [0.0; 3]);
        e.sprites[1].visible = false;
        e.step_physics(STEP);
        assert_eq!(e.sprites[1].x, x);
        e.sprites[1].visible = true;
        e.step_physics(STEP);
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
    LegacyVelocityVector,
    LegacyForce,
    LegacyForceVector,
    LegacyGravity,
    LegacyGravityOrientation,
    LegacyTexture(u8),
    LegacyEnable(bool),
    LegacyCollidable(bool),
    LegacyRotate(bool),
    LegacyBoundary(u8),
    LegacyFriction,
    LegacyRestitution,
    LegacyMass,
    LegacyDensity,
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
    pub fn parse_legacy(kind: &str, b: &Value) -> Result<Self> {
        Ok(match kind.trim_start_matches("kitten4_legacy_") {
            "self_enable_physics" => Self::LegacyEnable(true),
            "self_disable_physics" => Self::LegacyEnable(false),
            "set_actor_as" => {
                Self::LegacyCollidable(field(b, "physics_body_type") == "attend_physics_world")
            }
            "allow_rotate" => Self::LegacyRotate(field(b, "allow") != "0"),
            "self_set_friction" => Self::LegacyFriction,
            "self_set_restitution" => Self::LegacyRestitution,
            "self_set_mass" => Self::LegacyMass,
            "self_set_density" => Self::LegacyDensity,
            "set_velocity_by_vector" => Self::LegacyVelocityVector,
            "set_force" => Self::LegacyForce,
            "set_force_by_vector" => Self::LegacyForceVector,
            "set_gravity" => Self::LegacyGravity,
            "set_gravity_by_orientation" => Self::LegacyGravityOrientation,
            "self_texture" => Self::LegacyTexture(match field(b, "texture_type") {
                "elastic" => 0,
                "iron" => 1,
                "wood" => 2,
                _ => 3,
            }),
            "self_set_boundary" => Self::LegacyBoundary(match field(b, "physics_bound_type") {
                "not_bound" => 0,
                "all_bounds" => 15,
                "bottom_bound" => 2,
                "left_right_bottom_bounds" => 14,
                other => bail!("unknown legacy physics boundary {other}"),
            }),
            _ => bail!("unsupported legacy physics block {kind}"),
        })
    }
}

#[cfg(test)]
mod legacy_tests {
    use super::*;
    use crate::{engine::Program, studio::document::Document};
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
    fn legacy_setters_do_not_allocate_and_disable_clears_velocity() {
        let mut e = engine();
        for c in [
            Command::LegacyEnable(true),
            Command::LegacyFriction,
            Command::LegacyRestitution,
            Command::LegacyBoundary(15),
        ] {
            command(&mut e, 1, c, [0.8, 0.0, 0.0]);
            assert!(e.physics.is_none());
            assert!(e.physics_command(0, c, [0.8, 0.0, 0.0]).is_err());
        }
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::LegacyFriction, [2.0, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyRestitution, [-1.0, 0.0, 0.0]);
        assert_eq!(e.physics_property(1, Property::Friction), 1.0);
        assert_eq!(e.physics_property(1, Property::Restitution), 0.0);
        command(&mut e, 1, Command::LegacyVelocity, [2.0, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyEnable(false), [0.0; 3]);
        assert_eq!(e.physics_property(1, Property::Speed), 0.0);
        command(&mut e, 1, Command::LegacyVelocity, [3.0, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyEnable(true), [0.0; 3]);
        assert_eq!(e.physics_property(1, Property::Speed), 0.0);
        command(&mut e, 1, Command::LegacyBoundary(14), [0.0; 3]);
        assert_eq!(e.physics.as_ref().unwrap().worlds[&0].edges.len(), 3);
        command(&mut e, 1, Command::LegacyBoundary(0), [0.0; 3]);
        assert!(e.physics.as_ref().unwrap().worlds[&0].edges.is_empty());
    }

    #[test]
    fn legacy_exit_clears_velocity_but_hidden_attend_only_changes_forceable() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocity, [2.0, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyCollidable(false), [0.0; 3]);
        assert_eq!(e.legacy_physics_property(1, Property::Speed), 0.0);
        command(&mut e, 1, Command::LegacyCollidable(true), [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocity, [3.0, 0.0, 0.0]);
        assert_eq!(e.legacy_physics_property(1, Property::Speed), 0.0);
        command(&mut e, 1, Command::LegacyEnable(true), [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocity, [2.0, 0.0, 0.0]);
        e.sprites[1].visible = false;
        command(&mut e, 1, Command::LegacyCollidable(true), [0.0; 3]);
        assert_eq!(e.legacy_physics_property(1, Property::Speed), 2.0);
    }

    #[test]
    fn legacy_start_scan_creates_static_bodies_and_modern_blocks_suppress_it() {
        let p = Document::blank();
        let mut program = Program::compile(p.value()).unwrap();
        program.legacy_physics_scenes.insert(0);
        let mut e = Engine::new(program);
        e.start();
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        let b = &w.actors[&1];
        assert!(!b.forceable && b.collidable);
        assert!(w.bodies[b.handle].is_fixed());
        command(&mut e, 1, Command::LegacyEnable(true), [0.0; 3]);
        assert!(e.physics.as_ref().unwrap().worlds[&0].actors[&1].forceable);
        e.start();
        assert!(!e.physics.as_ref().unwrap().worlds[&0].actors[&1].forceable);
        command(&mut e, 1, Command::LegacyFriction, [0.7, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyEnable(true), [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocity, [2.0, 0.0, 0.0]);
        // clone_sprite calls this hook only for native K4; this internal
        // synthetic Program supplies the same provenance for the body test.
        e.sprites.push(e.sprites[1].clone());
        e.clone_legacy_physics_body(1, 2);
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        let b = &w.actors[&2];
        assert!(!b.forceable && !b.collidable);
        assert_eq!(w.colliders[b.collider].friction(), 0.7);
        assert_eq!(e.legacy_physics_property(2, Property::Speed), 0.0);
        e.remove_physics_body(2);
        assert_eq!(e.legacy_physics_property(2, Property::Friction), 0.0);
        e.program.has_modern_physics = true;
        e.start();
        assert!(e.physics.is_none());
    }

    #[test]
    fn remaining_legacy_body_commands_are_lazy_and_finite_checks_precede_scene_errors() {
        for c in [
            Command::LegacyVelocityVector,
            Command::LegacyForce,
            Command::LegacyForceVector,
        ] {
            let mut e = engine();
            command(&mut e, 1, c, [12.0, 0.0, 0.0]);
            assert!(e.physics.is_none(), "{c:?} allocated a body");
            command(&mut e, 0, c, [f64::NAN, 0.0, 0.0]);
            assert!(e.physics_command(0, c, [1.0, 0.0, 0.0]).is_err());
        }
        let mut e = engine();
        command(&mut e, 1, Command::LegacyTexture(1), [0.0; 3]);
        assert!(e.physics.is_none());
        assert!(
            e.physics_command(0, Command::LegacyTexture(1), [0.0; 3])
                .is_err()
        );
    }

    #[test]
    fn vector_velocity_limits_each_axis_not_the_magnitude_and_static_body_ignores_it() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(
            &mut e,
            1,
            Command::LegacyVelocityVector,
            [20000.0, -20000.0, 0.0],
        );
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        let b = &w.actors[&1];
        assert_eq!(*w.bodies[b.handle].linvel(), vector![100000.0, -100000.0]);
        command(&mut e, 1, Command::LegacyEnable(false), [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocityVector, [3.0, 4.0, 0.0]);
        command(&mut e, 1, Command::LegacyEnable(true), [0.0; 3]);
        assert_eq!(e.physics_property(1, Property::Speed), 0.0);
    }

    #[test]
    fn legacy_force_sums_components_and_is_cleared_after_exactly_one_fixed_tick() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::Mass, [2.0, 0.0, 0.0]);
        e.step_physics(STEP); // initialize newly registered world ticker
        command(&mut e, 1, Command::LegacyForce, [12.0, 0.0, 0.0]);
        command(&mut e, 1, Command::LegacyForceVector, [0.0, -12.0, 0.0]);
        e.step_physics(STEP);
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        let velocity = *w.bodies[w.actors[&1].handle].linvel();
        assert!((velocity.x - 1.0).abs() < 1e-9);
        assert!((velocity.y + 1.0).abs() < 1e-9);
        e.step_physics(STEP * 3.0);
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        assert_eq!(*w.bodies[w.actors[&1].handle].linvel(), velocity);
    }

    #[test]
    fn texture_presets_set_density_and_recompute_mass_without_changing_velocity() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        command(&mut e, 1, Command::LegacyVelocityVector, [3.0, 4.0, 0.0]);
        let w = &e.physics.as_ref().unwrap().worlds[&0];
        let original_mass = w.bodies[w.actors[&1].handle].mass();
        for (preset, density, friction, restitution) in [
            (0, 1.0, 0.1, 1.0),
            (1, 8.0, 0.2, 0.1),
            (2, 0.8, 0.4, 0.2),
            (3, 1.0, 0.1, 0.5),
        ] {
            command(&mut e, 1, Command::LegacyTexture(preset), [0.0; 3]);
            assert_eq!(e.physics_property(1, Property::Density), density);
            assert_eq!(e.physics_property(1, Property::Friction), friction);
            assert_eq!(e.physics_property(1, Property::Restitution), restitution);
            assert_eq!(e.physics_property(1, Property::Speed), 5.0);
            assert!((e.physics_property(1, Property::Mass) - original_mass * density).abs() < 0.02);
        }
    }

    #[test]
    fn global_gravity_and_orientation_use_all_existing_worlds_without_creating_bodies() {
        let mut e = engine();
        command(&mut e, 1, Command::LegacyGravity, [2.0, -90.0, 0.0]);
        assert!(e.physics.is_none());
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        e.physics
            .as_mut()
            .unwrap()
            .worlds
            .insert(2, World::default());
        command(&mut e, 1, Command::LegacyGravity, [3.0, 90.0, 0.0]);
        for w in e.physics.as_ref().unwrap().worlds.values() {
            assert!((w.gravity.y - 30.0).abs() < 1e-9);
        }
        // Unlike other physics blocks orientation is valid on a scene.
        command(
            &mut e,
            0,
            Command::LegacyGravityOrientation,
            [2.0, 0.0, 0.0],
        );
        for w in e.physics.as_ref().unwrap().worlds.values() {
            assert_eq!(w.gravity, Vector::zeros());
        }
        e.set_physics_device_orientation(10.0, -4.0, true);
        for w in e.physics.as_ref().unwrap().worlds.values() {
            assert_eq!(w.gravity, vector![-4.0, -10.0]);
        }
        // A neutral event does not overwrite the last gravity in the source.
        e.set_physics_device_orientation(0.0, 0.0, true);
        assert_eq!(
            e.physics.as_ref().unwrap().worlds[&0].gravity,
            vector![-4.0, -10.0]
        );
        e.set_physics_device_orientation(10.0, -4.0, false);
        assert_eq!(
            e.physics.as_ref().unwrap().worlds[&0].gravity,
            vector![-10.0, 4.0]
        );
        // An invalid manual command still detaches the previous listener.
        command(&mut e, 0, Command::LegacyGravity, [f64::NAN, 0.0, 0.0]);
        e.set_physics_device_orientation(40.0, 40.0, true);
        assert_eq!(
            e.physics.as_ref().unwrap().worlds[&0].gravity,
            vector![-10.0, 4.0]
        );
        command(
            &mut e,
            1,
            Command::LegacyGravityOrientation,
            [2.0, 0.0, 0.0],
        );
        e.start();
        assert!(e.physics.is_none());
    }

    #[test]
    fn rigid_flexibility_changes_reporter_only_and_clone_copies_strength() {
        let mut e = engine();
        command(&mut e, 1, Command::Gravity, [0.0; 3]);
        let mass = e.physics_property(1, Property::Mass);
        for (input, expected) in [(27.4, 27.0), (-50.0, 1.0), (f64::INFINITY, 100.0)] {
            command(&mut e, 1, Command::Flexibility, [input, 0.0, 0.0]);
            assert_eq!(e.physics_property(1, Property::Flexibility), expected);
            assert_eq!(e.physics_property(1, Property::Mass), mass);
            assert_eq!(e.physics_property(1, Property::Restitution), 0.0);
        }
        command(&mut e, 1, Command::Flexibility, [f64::NAN, 0.0, 0.0]);
        assert_eq!(e.physics_property(1, Property::Flexibility), 100.0);
        e.program.legacy_physics_scenes.insert(0);
        e.sprites.push(e.sprites[1].clone());
        e.clone_legacy_physics_body(1, 2);
        // The official constructor uses strength || 1, including when cloning
        // a strength-zero source (flexibility 100).
        assert_eq!(e.physics_property(2, Property::Flexibility), 80.0);
        command(&mut e, 1, Command::Hard, [0.0; 3]);
        assert_eq!(e.physics_property(1, Property::Flexibility), 100.0);
    }
}
impl Command {
    fn legacy(self) -> bool {
        matches!(
            self,
            Self::LegacyVelocity
                | Self::LegacyVelocityVector
                | Self::LegacyForce
                | Self::LegacyForceVector
                | Self::LegacyGravity
                | Self::LegacyGravityOrientation
                | Self::LegacyTexture(_)
                | Self::LegacyEnable(_)
                | Self::LegacyCollidable(_)
                | Self::LegacyRotate(_)
                | Self::LegacyBoundary(_)
                | Self::LegacyFriction
                | Self::LegacyRestitution
                | Self::LegacyMass
                | Self::LegacyDensity
        )
    }
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
    // Official adapter keeps this on rigid actors too. It only changes the
    // particle group when an elastic body actually exists (not implemented).
    strength: f64,
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
    // A newly registered world ticker does not integrate in its registration
    // batch. The first subsequent actor/body synchronization initializes it.
    initialized: bool,
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
            initialized: false,
        }
    }
}
#[derive(Default)]
pub(super) struct Physics {
    worlds: BTreeMap<usize, World>,
    orientation_gravity: Option<f64>,
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
    if let Some(mask_data @ (mw, mh, mask)) = costume.and_then(|c| c.mask.as_ref()) {
        if let Some(shape) = shape::convex_mask(w, h, mask_data, sx, sy) {
            return shape;
        }
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
    pub(super) fn clone_legacy_physics_body(&mut self, source: usize, clone: usize) {
        // player_v2 Vt.generate_clone_actor creates a non-forceable,
        // non-collidable body with the source material, NOT its velocity.
        if !self
            .program
            .legacy_physics_scenes
            .contains(&self.sprites[source].scene)
            || self.program.has_modern_physics
        {
            return;
        }
        let Some(world) = self
            .physics
            .as_ref()
            .and_then(|p| p.worlds.get(&self.sprites[source].scene))
        else {
            return;
        };
        let Some(body) = world.actors.get(&source) else {
            return;
        };
        let collider = &world.colliders[body.collider];
        let material = (
            collider.density(),
            collider.friction(),
            collider.restitution(),
            body.strength,
        );
        self.ensure_physics_body(clone);
        self.physics_command(clone, Command::Forceable(false), [0.0; 3])
            .unwrap();
        self.physics_command(clone, Command::Collidable(false), [0.0; 3])
            .unwrap();
        let w = self
            .physics
            .as_mut()
            .unwrap()
            .worlds
            .get_mut(&self.sprites[clone].scene)
            .unwrap();
        let b = w.actors.get_mut(&clone).unwrap();
        w.bodies[b.handle].set_body_type(RigidBodyType::Fixed, true);
        b.strength = if material.3 == 0.0 { 1.0 } else { material.3 };
        let c = &mut w.colliders[b.collider];
        c.set_density(material.0);
        c.set_friction(material.1);
        c.set_restitution(material.2);
        w.bodies[b.handle].recompute_mass_properties_from_colliders(&w.colliders);
    }
    pub(super) fn initialize_legacy_physics(&mut self) {
        // Offline player_v2 load_physics_model: only self_enable_physics
        // requests old worlds, and ANY physics2 block suppresses that path.
        if self.program.has_modern_physics {
            return;
        }
        for actor in 0..self.sprites.len() {
            if !self.sprites[actor].stage
                && self
                    .program
                    .legacy_physics_scenes
                    .contains(&self.sprites[actor].scene)
            {
                self.ensure_physics_body(actor);
                self.physics_command(actor, Command::Forceable(false), [0.0; 3])
                    .unwrap();
                let w = self
                    .physics
                    .as_mut()
                    .unwrap()
                    .worlds
                    .get_mut(&self.sprites[actor].scene)
                    .unwrap();
                let b = &w.actors[&actor];
                w.bodies[b.handle].set_body_type(RigidBodyType::Fixed, true);
            }
        }
    }
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
                strength: 2.5,
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
        let legacy = command.legacy();
        if matches!(
            command,
            Command::LegacyVelocity
                | Command::LegacyVelocityVector
                | Command::LegacyForce
                | Command::LegacyForceVector
        ) && (!values[0].is_finite() || !values[1].is_finite())
        {
            return Ok(None);
        }
        // Orientation gravity has no entity lookup in Bt. With no browser
        // sensor events it stays zero, not the previous world gravity.
        if matches!(command, Command::LegacyGravityOrientation) {
            if values[0].is_finite() {
                let p = self.physics.get_or_insert_with(Default::default);
                p.orientation_gravity = Some(values[0].clamp(-10000.0, 10000.0));
                for world in p.worlds.values_mut() {
                    world.gravity = Vector::zeros();
                }
            }
            return Ok(None);
        }
        if matches!(command, Command::LegacyGravity) {
            // Even an invalid manual gravity command removes the listener.
            if let Some(p) = self.physics.as_mut() {
                p.orientation_gravity = None;
            }
            if !values[0].is_finite() || !values[1].is_finite() {
                return Ok(None);
            }
            ensure!(
                !self.sprites[actor].stage,
                "Kitten 4 physics blocks cannot run on a scene"
            );
            if let Some(p) = self.physics.as_mut() {
                let r = values[1].to_radians();
                let magnitude = values[0].clamp(-10000.0, 10000.0) * 10.0;
                for world in p.worlds.values_mut() {
                    world.gravity = vector![magnitude * r.cos(), magnitude * r.sin()];
                }
            }
            return Ok(None);
        }
        ensure!(
            !self.sprites[actor].stage,
            "Kitten 4 physics blocks cannot run on a scene"
        );
        // Modern gravity/speed validate before their lazy world/body helper.
        // A scene still errors first, unlike the old finite-first commands.
        if matches!(command, Command::Gravity | Command::Speed)
            && (values[0].is_nan() || !values[1].is_finite())
        {
            return Ok(None);
        }
        if let Command::LegacyBoundary(mask) = command {
            let actors: Vec<_> = self
                .physics
                .as_ref()
                .into_iter()
                .flat_map(|p| p.worlds.values())
                .filter_map(|w| w.actors.keys().next().copied())
                .collect();
            for actor in actors {
                self.physics_command(actor, Command::Boundary(mask), values)?;
            }
            return Ok(None);
        }
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
        let command = match command {
            Command::LegacyEnable(enabled) => {
                if enabled {
                    self.physics_command(actor, Command::Collidable(true), values)?;
                } else {
                    let w = self
                        .physics
                        .as_mut()
                        .unwrap()
                        .worlds
                        .get_mut(&self.sprites[actor].scene)
                        .unwrap();
                    let b = w.actors.get_mut(&actor).unwrap();
                    w.bodies[b.handle].set_linvel(Vector::zeros(), true);
                }
                let w = self
                    .physics
                    .as_mut()
                    .unwrap()
                    .worlds
                    .get_mut(&self.sprites[actor].scene)
                    .unwrap();
                let b = w.actors.get_mut(&actor).unwrap();
                w.bodies[b.handle].set_body_type(
                    if enabled {
                        RigidBodyType::Dynamic
                    } else {
                        RigidBodyType::Fixed
                    },
                    true,
                );
                Command::Forceable(enabled)
            }
            Command::LegacyCollidable(enabled) => {
                // is_enabled is forceable || collidable in the old adapter.
                let w = &self.physics.as_ref().unwrap().worlds[&self.sprites[actor].scene];
                let b = &w.actors[&actor];
                if enabled != (self.sprites[actor].visible && (b.forceable || enabled)) {
                    self.physics_command(actor, Command::Forceable(false), values)?;
                    if !enabled {
                        // Bt.set_actor_as(exit) also calls the underlying
                        // Box2D set_dynamic(false), which clears velocity.
                        // Merely changing adapter forceable preserves it until
                        // the next ticker, so the modern command differs here.
                        let w = self
                            .physics
                            .as_mut()
                            .unwrap()
                            .worlds
                            .get_mut(&self.sprites[actor].scene)
                            .unwrap();
                        let b = w.actors.get_mut(&actor).unwrap();
                        w.bodies[b.handle].set_linvel(Vector::zeros(), true);
                        w.bodies[b.handle].set_body_type(RigidBodyType::Fixed, true);
                    }
                }
                Command::Collidable(enabled)
            }
            Command::LegacyRotate(enabled) => Command::Rotate(enabled),
            Command::LegacyFriction => Command::Friction,
            Command::LegacyRestitution => Command::Restitution,
            Command::LegacyMass => Command::Mass,
            other => other,
        };
        // Soft remains a documented rigid fallback, not a particle simulation.
        // Flexibility below implements the official rigid-adapter metadata and
        // reporter only; changing it must not fake a deformation or restitution.
        if matches!(command, Command::Soft) {
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
                // Adapter flags are synchronous, but update_body_state applies
                // the actual body type on the PIXI ticker, only while enabled.
                // This distinction is observable by a following set_velocity.
                state.forceable = enabled;
            }
            Command::Collidable(enabled) => state.collidable = enabled,
            Command::Rotate(enabled) => {
                state.rotate = enabled;
                body.lock_rotations(!enabled, true);
            }
            Command::Gravity if !value.is_nan() && dir.is_finite() => {
                world.gravity = vector(10000.0)
            }
            Command::Speed if !value.is_nan() && dir.is_finite() && body.is_dynamic() => {
                body.set_linvel(vector(12.0), true)
            }
            Command::LegacyVelocity => {
                if body.is_dynamic() {
                    body.set_linvel(vector(10000.0), true)
                }
            }
            Command::LegacyVelocityVector => {
                if body.is_dynamic() {
                    let velocity = vector![
                        value.clamp(-10000.0, 10000.0) * 10.0,
                        dir.clamp(-10000.0, 10000.0) * 10.0
                    ];
                    body.set_linvel(velocity, true);
                }
            }
            Command::LegacyForce => body.add_force(vector(10000.0), true),
            Command::LegacyForceVector => body.add_force(
                vector![
                    value.clamp(-10000.0, 10000.0) * 10.0,
                    dir.clamp(-10000.0, 10000.0) * 10.0
                ],
                true,
            ),
            Command::LegacyTexture(texture) => {
                let (restitution, friction, density) = match texture {
                    0 => (1.0, 0.1, 1.0),
                    1 => (0.1, 0.2, 8.0),
                    2 => (0.2, 0.4, 0.8),
                    _ => (0.5, 0.1, 1.0),
                };
                let collider = &mut world.colliders[state.collider];
                collider.set_restitution(restitution);
                collider.set_friction(friction);
                collider.set_density(density * 0.1);
                body.recompute_mass_properties_from_colliders(&world.colliders);
            }
            Command::Flexibility if !value.is_nan() => {
                state.strength = (100.0 - value.clamp(1.0, 100.0)) / 100.0 * 5.0;
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
            Command::LegacyDensity if value.is_finite() && value >= 0.0 => {
                world.colliders[state.collider].set_density(value * 0.1);
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
                            // a1xw/Qt.create_edges uses the Box2D FixtureDef
                            // default, unlike actor bodies' explicit 0.1.
                            .friction(0.2)
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
            Property::Speed => body.linvel().norm() / 10.0,
            Property::Direction => {
                let v = body.linvel();
                v.y.atan2(v.x).to_degrees()
            }
            // Box2D GetMass returns zero for static bodies. Rapier retains the
            // collider-derived local mass even while fixed; do not expose it.
            // Official observations: partial-physics-6 legacy/modern-membership.
            Property::Mass if body.is_fixed() => 0.0,
            Property::Mass => body.mass(),
            Property::Friction => w.colliders[b.collider].friction(),
            Property::Restitution => w.colliders[b.collider].restitution(),
            Property::Flexibility => {
                (100.0 - (b.strength / 5.0 * 100.0 + 0.5).floor()).clamp(1.0, 100.0)
            }
            Property::Density => w.colliders[b.collider].density() / 0.1,
        };
        (value * 100.0 + 0.5).floor() / 100.0
    }
    pub(super) fn legacy_physics_property(&mut self, actor: usize, property: Property) -> f64 {
        if !self
            .physics
            .as_ref()
            .and_then(|p| p.worlds.get(&self.sprites[actor].scene))
            .is_some_and(|w| w.actors.contains_key(&actor))
        {
            return 0.0;
        }
        self.physics_property(actor, property)
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
                if body.is_enabled() {
                    let kind = if b.forceable {
                        RigidBodyType::Dynamic
                    } else {
                        RigidBodyType::Fixed
                    };
                    if body.body_type() != kind {
                        if !b.forceable {
                            body.set_linvel(Vector::zeros(), true);
                        }
                        body.set_body_type(kind, true);
                    }
                }
                let position = Isometry::new(
                    vector![a.x / PIXELS, a.y / PIXELS],
                    (90.0 - a.direction).to_radians(),
                );
                if (body.position().translation.vector - position.translation.vector).norm() > 1e-8
                    || (body.rotation().angle() - position.rotation.angle()).abs() > 1e-8
                {
                    body.set_position(position, true);
                }
                let new_signature = signature(a);
                if b.shape != new_signature {
                    w.colliders[b.collider].set_shape(geometry(self, actor));
                    // A rebuilt silhouette changes area and inertia even when
                    // its density is unchanged. Do not leave the old mass on
                    // the rigid body until an unrelated material command.
                    body.recompute_mass_properties_from_colliders(&w.colliders);
                    b.shape = new_signature;
                }
                w.colliders[b.collider].set_sensor(b.forceable && !b.collidable);
            }
            if !w.initialized {
                // Legacy worlds are preallocated by Start, before the first
                // interpreter update. Their ticker registration still belongs
                // to that update, as the original membership/gravity probes
                // show: first motion is update 3, not update 2.
                w.initialized = self.program.has_modern_physics
                    || !self.program.legacy_physics_scenes.contains(&scene)
                    || self.time > STEP + 1e-10;
                continue;
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
                    let body = &mut w.bodies[b.handle];
                    if body.is_enabled() && body.is_dynamic() && !body.is_sleeping() {
                        // Pcni/Island.Solve integrates forces once, then caps
                        // translation to 2 physics units (20px), rotation pi/2.
                        // Preintegrate before Rapier's substeps so free fall is
                        // semi-implicit Euler, not four fractional gravity steps.
                        let acceleration = w.gravity * body.gravity_scale()
                            + body
                                .user_force()
                                .component_mul(&body.mass_properties().effective_inv_mass);
                        let mut velocity = *body.linvel() + acceleration * STEP;
                        let limit = 2.0 / STEP;
                        if velocity.norm_squared() > limit * limit {
                            velocity *= limit / velocity.norm();
                        }
                        body.set_linvel(velocity, false);
                        body.set_angvel(
                            body.angvel().clamp(
                                -std::f64::consts::FRAC_PI_2 / STEP,
                                std::f64::consts::FRAC_PI_2 / STEP,
                            ),
                            false,
                        );
                        body.reset_forces(false);
                    }
                }
                w.pipeline.step(
                    &Vector::zeros(),
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
                if (a.x, a.y, a.direction) != (x, y, direction) {
                    a.x = x;
                    a.y = y;
                    a.direction = direction;
                    self.dirty[actor] = true;
                }
            }
        }
        self.physics = Some(physics);
    }
    /// Feed a real deviceorientation event to the legacy gravity listener.
    /// No synthetic events are generated in headless execution. `portrait`
    /// corresponds to the orientation captured when the official domain loads.
    pub fn set_physics_device_orientation(&mut self, beta: f64, gamma: f64, portrait: bool) {
        let Some(p) = self.physics.as_mut() else {
            return;
        };
        let Some(value) = p.orientation_gravity else {
            return;
        };
        let beta = if beta.is_finite() { beta } else { 0.0 };
        let gamma = if gamma.is_finite() { gamma } else { 0.0 };
        if beta == 0.0 && gamma == 0.0 {
            return;
        }
        let (x, y) = if portrait {
            (gamma, -beta)
        } else {
            (-beta, -gamma)
        };
        for world in p.worlds.values_mut() {
            world.gravity = vector![value * x * 0.05 * 10.0, value * y * 0.05 * 10.0];
        }
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
