//! Independently implemented marching-squares outline for the K4 physics mask.
//! Official evidence: a1xw/Data.collect_texture_convex_groups and JfQ3 f/c;
//! see docs/kitten4-physics-trajectory-3.md. No embedded player source.
use rapier2d_f64::prelude::*;

type Point = [f64; 2];

fn distance_squared(point: Point, a: Point, b: Point) -> f64 {
    let edge = [b[0] - a[0], b[1] - a[1]];
    let length = edge[0] * edge[0] + edge[1] * edge[1];
    let t = if length == 0.0 {
        0.0
    } else {
        (((point[0] - a[0]) * edge[0] + (point[1] - a[1]) * edge[1]) / length).clamp(0.0, 1.0)
    };
    (point[0] - a[0] - t * edge[0]).powi(2) + (point[1] - a[1] - t * edge[1]).powi(2)
}

fn simplify(points: &[Point], output: &mut Vec<Point>, depth: usize) {
    // Bound recursion for hostile/noisy masks; fall back to the old geometry.
    if points.len() <= 2 || depth >= 64 {
        output.extend_from_slice(points);
        return;
    }
    let last = points.len() - 1;
    let split = (1..last).max_by(|&a, &b| {
        distance_squared(points[a], points[0], points[last]).total_cmp(&distance_squared(
            points[b],
            points[0],
            points[last],
        ))
    });
    if let Some(index) = split
        && distance_squared(points[index], points[0], points[last]) > 25.0
    {
        simplify(&points[..=index], output, depth + 1);
        output.pop();
        simplify(&points[index..], output, depth + 1);
    } else {
        output.extend_from_slice(&[points[0], points[last]]);
    }
}

/// Fully opaque rectangular textures only. Other masks keep the compound-run
/// fallback until Canvas resampling and convex decomposition are verified.
pub(super) fn convex_mask(
    width: f64,
    height: f64,
    mask: &(usize, usize, Vec<u8>),
    sx: f64,
    sy: f64,
) -> Option<SharedShape> {
    let (mw, mh, bytes) = mask;
    let w = (width * 0.7).floor() as usize;
    let h = (height * 0.7).floor() as usize;
    if w == 0 || h == 0 || w.saturating_mul(h) > 1_000_000 || *mw == 0 || *mh == 0 {
        return None;
    }
    let solid = |x: i32, y: i32| {
        if x < 0 || y < 0 || x as usize >= w || y as usize >= h {
            return false;
        }
        let mx = ((x as f64 + 0.5) * *mw as f64 / w as f64) as usize;
        let my = ((y as f64 + 0.5) * *mh as f64 / h as f64) as usize;
        let bit = my * mw + mx;
        bytes
            .get(bit / 8)
            .is_some_and(|v| v & (1 << (bit % 8)) != 0)
    };
    if (0..*mw * *mh).any(|bit| bytes.get(bit / 8).is_none_or(|v| v & (1 << (bit % 8)) == 0)) {
        return None;
    }
    // The pinned player starts its alpha scan at packed pixel index 3.
    let start = (3..w * h).find(|&index| solid((index % w) as i32, (index / w) as i32))?;
    let origin = ((start % w) as i32, (start / w) as i32);
    let (mut x, mut y) = origin;
    let mut previous = (0, 0);
    let mut outline = Vec::new();
    for _ in 0..(w * h * 4 + 4) {
        let code = u8::from(solid(x - 1, y - 1))
            | u8::from(solid(x, y - 1)) << 1
            | u8::from(solid(x - 1, y)) << 2
            | u8::from(solid(x, y)) << 3;
        let direction = match code {
            1 | 5 | 13 => (0, -1),
            8 | 10 | 11 => (0, 1),
            4 | 12 | 14 => (-1, 0),
            2 | 3 | 7 => (1, 0),
            6 if previous == (0, -1) => (-1, 0),
            6 => (1, 0),
            9 if previous == (1, 0) => (0, -1),
            9 => (0, 1),
            _ => return None,
        };
        x += direction.0;
        y += direction.1;
        if direction != previous {
            outline.push([x as f64, y as f64]);
        }
        previous = direction;
        if (x, y) == origin {
            break;
        }
    }
    if (x, y) != origin || outline.len() < 3 {
        return None;
    }
    let mut simplified = Vec::new();
    simplify(&outline, &mut simplified, 0);
    if simplified.len() < 3 {
        return None;
    }
    let mut sign = 0.0_f64;
    for i in 0..simplified.len() {
        let a = simplified[i];
        let b = simplified[(i + 1) % simplified.len()];
        let c = simplified[(i + 2) % simplified.len()];
        let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if cross.abs() > 1e-9 {
            if sign != 0.0 && sign.signum() != cross.signum() {
                return None;
            }
            sign = cross;
        }
    }
    let points: Vec<_> = simplified
        .iter()
        .map(|p| {
            point![
                ((p[0] / 0.7).floor() - width / 2.0) * sx,
                (height / 2.0 - (p[1] / 0.7).floor()) * sy
            ]
        })
        .collect();
    SharedShape::convex_hull(&points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_twenty_pixel_texture_matches_official_fixture_mass() {
        let shape = convex_mask(20.0, 20.0, &(20, 20, vec![255; 50]), 0.1, 0.1).unwrap();
        // Read-only shape probe observes vertices (1,.8),(-.9,1),
        // (-.8,-1),(.8,-1) in the player's downward-positive coordinates.
        assert!((shape.mass_properties(0.1).mass() - 0.333).abs() < 1e-12);
    }
}
