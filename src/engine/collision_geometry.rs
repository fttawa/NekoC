//! Opaque-point sampling shared by single-point and overlap collision checks.
use super::CostumeGeometry;

impl CostumeGeometry<'_> {
    pub(super) fn contains(&self, x: f64, y: f64) -> bool {
        let Some((u, v)) = self.uv(x, y) else {
            return false;
        };
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return false;
        }
        match &self.costume.mask {
            None => true,
            Some((mw, mh, bits)) => {
                let (px, py) = ((u * *mw as f64) as usize, (v * *mh as f64) as usize);
                let bit = py * mw + px;
                bits.get(bit / 8)
                    .is_some_and(|byte| byte >> (bit % 8) & 1 == 1)
            }
        }
    }
}

#[cfg(test)]
mod tests;
