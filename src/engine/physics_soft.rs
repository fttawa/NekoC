//! Independently authored particle approximation, NOT a LiquidFun implementation.
//! Observed source anchors and remaining deformation gap:
//! docs/kitten4-partial-physics-9.md. Never synthesize a particle trajectory from
//! an oracle recording, or call a rigid collider a compatible soft body.
use rapier2d_f64::prelude::*;

const STRIDE: f64 = 1.8;
const RADIUS: f64 = 1.2;

/// Rest topology is generated from the decoded costume, never oracle points.
/// The regular alpha lattice and local triangle projections deliberately do not
/// claim to reproduce the player's contour/Voronoi/pressure solver.
pub(super) struct Particles {
    pub points: Vec<Vector<f64>>,
    pub velocities: Vec<Vector<f64>>,
    rest: Vec<Vector<f64>>,
    rest_size: [f64; 2],
    pub triangles: Vec<[usize; 3]>,
    anchor_offset: Vector<f64>,
    pub pose: Isometry<f64>,
}

impl Particles {
    pub fn new(
        costume: Option<&super::super::Costume>,
        scale: [f64; 2],
        pose: Isometry<f64>,
        velocity: Vector<f64>,
    ) -> Option<Self> {
        let costume = costume?;
        costume.mask.as_ref()?;
        let width = costume.width * scale[0].abs();
        let height = costume.height * scale[1].abs();
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return None;
        }
        if width > STRIDE * 1023.0 || height > STRIDE * 1023.0 {
            return None;
        }
        let nx = (width / STRIDE).floor() as usize + 1;
        let ny = (height / STRIDE).floor() as usize + 1;
        // Bounded work for hostile scales; unsupported geometry stays explicit.
        if nx.saturating_mul(ny) > 1024 {
            return None;
        }
        let mut rest = Vec::new();
        let mut grid = vec![None; nx * ny];
        for y in 0..ny {
            for x in 0..nx {
                let local = vector![
                    (x as f64 - (nx - 1) as f64 / 2.0) * STRIDE,
                    (y as f64 - (ny - 1) as f64 / 2.0) * STRIDE
                ];
                let u = local.x / width + 0.5;
                let v = 0.5 - local.y / height;
                let solid = costume.mask.as_ref().is_none_or(|(mw, mh, bytes)| {
                    if *mw == 0 || *mh == 0 {
                        return false;
                    }
                    let x = (u.clamp(0.0, 1.0 - f64::EPSILON) * *mw as f64) as usize;
                    let y = (v.clamp(0.0, 1.0 - f64::EPSILON) * *mh as f64) as usize;
                    let bit = y * mw + x;
                    bytes
                        .get(bit / 8)
                        .is_some_and(|v| v & (1 << (bit % 8)) != 0)
                });
                if solid {
                    grid[y * nx + x] = Some(rest.len());
                    rest.push(local);
                }
            }
        }
        if rest.len() < 3 {
            return None;
        }
        let mut triangles = Vec::new();
        for y in 0..ny - 1 {
            for x in 0..nx - 1 {
                let [a, b, c, d] = [
                    grid[y * nx + x],
                    grid[y * nx + x + 1],
                    grid[(y + 1) * nx + x],
                    grid[(y + 1) * nx + x + 1],
                ];
                for triangle in [[a, b, c], [b, d, c]] {
                    if let [Some(a), Some(b), Some(c)] = triangle {
                        triangles.push([a, b, c]);
                    }
                }
            }
        }
        if triangles.is_empty() {
            return None;
        }
        let points: Vec<_> = rest
            .iter()
            .map(|p| pose.rotation * p + pose.translation.vector)
            .collect();
        // The pinned official group uses the middle particle as its anchor,
        // not the mean position (see soft-blocked-model evidence).
        let anchor_offset = rest[rest.len() / 2];
        Some(Self {
            velocities: vec![velocity; points.len()],
            points,
            rest,
            rest_size: [width, height],
            triangles,
            anchor_offset,
            pose,
        })
    }

    pub fn set_velocity(&mut self, velocity: Vector<f64>) {
        self.velocities.fill(velocity);
    }

    pub fn velocity(&self) -> Vector<f64> {
        self.velocities.iter().copied().sum::<Vector<f64>>() / self.velocities.len() as f64
    }

    pub fn transform(&mut self, pose: Isometry<f64>) {
        if (pose.translation.vector - self.pose.translation.vector).norm_squared() < 1e-24
            && (pose.rotation.angle() - self.pose.rotation.angle()).abs() < 1e-12
        {
            return;
        }
        let delta = pose * self.pose.inverse();
        for p in &mut self.points {
            *p = delta.rotation * *p + delta.translation.vector;
        }
        self.pose = pose;
    }

    /// Local corotated triangle projections and short-range separation. Strength
    /// is the observed adapter value, but this projection mapping is UNVERIFIED.
    /// Collision callback allows the owning Rapier world to supply real shapes.
    pub fn step(
        &mut self,
        dt: f64,
        gravity: Vector<f64>,
        strength: f64,
        mut collide: impl FnMut(Vector<f64>, &mut Vector<f64>, &mut Vector<f64>),
    ) {
        let iterations = 4;
        let h = dt / iterations as f64;
        let stiffness = 1.0 - (-strength.max(0.0) * h * 12.0).exp();
        for _ in 0..iterations {
            let previous = self.points.clone();
            for (p, v) in self.points.iter_mut().zip(&mut self.velocities) {
                *v += gravity * h;
                let speed = v.norm();
                if speed > STRIDE / h {
                    *v *= STRIDE / h / speed;
                }
                *p += *v * h;
            }
            let mut correction = vec![Vector::zeros(); self.points.len()];
            let mut weights = vec![0.0_f64; self.points.len()];
            for triangle in &self.triangles {
                let center = triangle
                    .iter()
                    .map(|&i| self.points[i])
                    .sum::<Vector<f64>>()
                    / 3.0;
                let rest_center = triangle.iter().map(|&i| self.rest[i]).sum::<Vector<f64>>() / 3.0;
                let (mut dot, mut cross) = (0.0, 0.0);
                for &i in triangle {
                    let a = self.rest[i] - rest_center;
                    let b = self.points[i] - center;
                    dot += a.dot(&b);
                    cross += a.x * b.y - a.y * b.x;
                }
                let rotation = Rotation::new(cross.atan2(dot));
                for &i in triangle {
                    correction[i] += (center + rotation * (self.rest[i] - rest_center)
                        - self.points[i])
                        * stiffness;
                    weights[i] += 1.0;
                }
            }
            for i in 0..self.points.len() {
                self.points[i] += correction[i] / weights[i].max(1.0);
            }
            // Particle radius is a contact radius, not the lattice spacing.
            // Use stride here to avoid expanding the rest lattice every frame.
            for a in 0..self.points.len() {
                for b in 0..a {
                    let delta = self.points[a] - self.points[b];
                    let distance = delta.norm();
                    if distance > 1e-9 && distance < STRIDE {
                        let correction = delta * ((STRIDE - distance) * 0.25 / distance);
                        self.points[a] += correction;
                        self.points[b] -= correction;
                    }
                }
            }
            for ((p, v), old) in self
                .points
                .iter_mut()
                .zip(&mut self.velocities)
                .zip(previous)
            {
                *v = (*p - old) / h;
                collide(old, p, v);
            }
        }
        let center = self.points[self.points.len() / 2];
        // Official rotation follows the first particle relative to the anchor,
        // not a least-squares rigid fit (source anchor in soft documentation).
        let first = self.points[0] - center;
        let initial = self.rest[0] - self.anchor_offset;
        let rotation = Rotation::new(first.y.atan2(first.x) - initial.y.atan2(initial.x));
        self.pose = Isometry::from_parts(
            Translation::from(center - rotation * self.anchor_offset),
            rotation,
        );
    }

    pub fn mesh(&self) -> super::super::SoftMesh {
        let [width, height] = self.rest_size;
        super::super::SoftMesh {
            vertices: self
                .points
                .iter()
                .zip(&self.rest)
                .map(|(p, r)| {
                    [
                        p.x * 10.0,
                        p.y * 10.0,
                        r.x / width + 0.5,
                        0.5 - r.y / height,
                    ]
                })
                .collect(),
            triangles: self.triangles.clone(),
        }
    }

    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({"points": self.points.iter().map(|p| [p.x*10.0,p.y*10.0]).collect::<Vec<_>>(), "velocities": self.velocities.iter().map(|p| [p.x*10.0,p.y*10.0]).collect::<Vec<_>>(), "triangles": self.triangles.len(), "radius": RADIUS, "stride": STRIDE, "substeps": 4})
    }
}

#[derive(Default)]
pub(super) struct Lifecycle {
    elastic: bool,
    generation: u64,
    live: bool,
    pending_geometry: bool,
}

impl Lifecycle {
    pub fn elastic(&self) -> bool {
        self.elastic
    }

    /// Same-mode commands are idempotent. A mode switch preserves the caller's
    /// velocity; only a geometry/enable reconstruction discards soft velocity.
    pub fn set_elastic(&mut self, elastic: bool, enabled: bool) -> bool {
        if elastic == self.elastic {
            return false;
        }
        self.elastic = elastic;
        self.live = elastic && enabled;
        if self.live {
            self.generation += 1;
        }
        self.pending_geometry = false;
        true
    }

    /// Returns true exactly when reconstruction must clear the body velocity.
    /// Hidden/disabled geometry is deferred until the first enabled actor tick.
    pub fn synchronize(&mut self, enabled: bool, geometry_changed: bool) -> bool {
        if !self.elastic {
            return false;
        }
        self.pending_geometry |= geometry_changed;
        if !enabled {
            self.live = false;
            return false;
        }
        let rebuild = !self.live || self.pending_geometry;
        if rebuild {
            self.generation += 1;
        }
        self.live = true;
        self.pending_geometry = false;
        rebuild
    }

    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "elastic": self.elastic, "generation": self.generation,
            "live": self.live, "pendingGeometry": self.pending_geometry,
            "model": "rigid-fallback", "deformationImplemented": false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_is_idempotent_and_geometry_rebuild_is_deferred_while_disabled() {
        let mut state = Lifecycle::default();
        assert!(!state.set_elastic(false, true));
        assert!(state.set_elastic(true, true));
        assert_eq!(state.generation, 1);
        assert!(!state.set_elastic(true, true));
        assert!(!state.synchronize(true, false));
        assert!(state.synchronize(true, true));
        assert_eq!(state.generation, 2);
        assert!(!state.synchronize(false, true));
        assert!(state.pending_geometry);
        assert!(state.synchronize(true, false));
        assert_eq!(state.generation, 3);
        assert!(state.set_elastic(false, true));
        assert!(!state.synchronize(true, true));
    }

    fn particles() -> Particles {
        Particles::new(
            Some(&super::super::super::Costume {
                width: 72.0,
                height: 72.0,
                mask: Some((8, 8, vec![255; 8])),
                ..Default::default()
            }),
            [0.1, 0.1],
            Isometry::identity(),
            vector![2.0, 0.0],
        )
        .unwrap()
    }

    #[test]
    fn free_translation_preserves_rest_distances_and_mean_velocity() {
        let mut p = particles();
        let rest = p.points.clone();
        for _ in 0..90 {
            p.step(1.0 / 60.0, Vector::zeros(), 2.5, |_, _, _| {});
        }
        for (got, start) in p.points.iter().zip(rest) {
            assert!((*got - start - vector![3.0, 0.0]).norm() < 1e-9);
        }
        assert!((p.velocity() - vector![2.0, 0.0]).norm() < 1e-9);
    }

    #[test]
    fn impact_changes_pair_distances_and_strength_changes_response() {
        let mut states = [particles(), particles()];
        for (state, strength) in states.iter_mut().zip([0.5, 3.75]) {
            state.set_velocity(vector![0.0, -2.0]);
            for _ in 0..30 {
                state.step(1.0 / 60.0, vector![0.0, -20.0], strength, |_, p, v| {
                    if p.y < -4.0 {
                        p.y = -4.0;
                        v.y = v.y.max(0.0);
                    }
                });
            }
            assert!(state.points.iter().all(|p| p.y >= -4.0));
            assert!(state.points.iter().all(|p| p.iter().all(|n| n.is_finite())));
            assert!(state.points.iter().zip(&state.rest).any(|(p, r)| {
                ((*p - state.points[0]).norm() - (*r - state.rest[0]).norm()).abs() > 0.01
            }));
        }
        assert!(
            states[0]
                .points
                .iter()
                .zip(&states[1].points)
                .any(|(a, b)| (a - b).norm() > 0.001)
        );
    }

    #[test]
    fn missing_mask_and_unbounded_geometry_are_not_claimed_as_particle_support() {
        assert!(
            Particles::new(
                Some(&super::super::super::Costume {
                    width: 20.0,
                    height: 20.0,
                    ..Default::default()
                }),
                [0.1; 2],
                Isometry::identity(),
                Vector::zeros()
            )
            .is_none()
        );
        let costume = super::super::super::Costume {
            width: 1e9,
            height: 1e9,
            mask: Some((1, 1, vec![1])),
            ..Default::default()
        };
        assert!(
            Particles::new(
                Some(&costume),
                [1.0; 2],
                Isometry::identity(),
                Vector::zeros()
            )
            .is_none()
        );
    }
}
