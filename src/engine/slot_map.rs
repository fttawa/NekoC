//! Per-entity variable table. An entity owns only a handful of private
//! variables, and the interpreter reads them millions of times per second; a
//! slot-sorted Vec beats BTreeMap's node walk for that size while keeping the
//! same ordered iteration.
use super::Cell;

#[derive(Clone, Debug, Default)]
pub(super) struct SlotMap(Vec<(usize, Cell)>);

impl SlotMap {
    pub(super) fn new() -> Self {
        Self(Vec::new())
    }

    #[inline]
    fn find(&self, slot: usize) -> Result<usize, usize> {
        // Tables are tiny: a linear scan over sorted keys stays branch-predictable.
        if self.0.len() <= 8 {
            for (i, &(key, _)) in self.0.iter().enumerate() {
                if key >= slot {
                    return if key == slot { Ok(i) } else { Err(i) };
                }
            }
            return Err(self.0.len());
        }
        self.0.binary_search_by_key(&slot, |&(key, _)| key)
    }

    #[inline]
    pub(super) fn get(&self, slot: &usize) -> Option<&Cell> {
        self.find(*slot).ok().map(|i| &self.0[i].1)
    }

    #[inline]
    pub(super) fn get_mut(&mut self, slot: &usize) -> Option<&mut Cell> {
        self.find(*slot).ok().map(|i| &mut self.0[i].1)
    }

    pub(super) fn contains_key(&self, slot: &usize) -> bool {
        self.find(*slot).is_ok()
    }

    /// Like BTreeMap::insert: returns the previous value of the slot.
    pub(super) fn insert(&mut self, slot: usize, value: Cell) -> Option<Cell> {
        match self.find(slot) {
            Ok(i) => Some(std::mem::replace(&mut self.0[i].1, value)),
            Err(i) => {
                self.0.insert(i, (slot, value));
                None
            }
        }
    }

    /// Entries in ascending slot order, shaped like BTreeMap::iter.
    pub(super) fn iter(&self) -> impl Iterator<Item = (&usize, &Cell)> {
        self.0.iter().map(|(k, v)| (k, v))
    }

    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(super) fn clear(&mut self) {
        self.0.clear();
    }
}

impl FromIterator<(usize, Cell)> for SlotMap {
    fn from_iter<I: IntoIterator<Item = (usize, Cell)>>(items: I) -> Self {
        let mut map = Self::new();
        for (slot, value) in items {
            map.insert(slot, value);
        }
        map
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn behaves_like_an_ordered_map_on_both_search_paths() {
        for count in [0usize, 3, 8, 9, 40] {
            let mut map = SlotMap::new();
            let mut reference = std::collections::BTreeMap::new();
            // Insert out of order, with duplicates, to exercise shifting inserts.
            for i in (0..count).rev().chain(0..count / 2) {
                let slot = i * 3 + 1;
                let value = Cell::Number((i * 7) as f64);
                assert_eq!(
                    map.insert(slot, value.clone()).map(|c| c.text()),
                    reference.insert(slot, value).map(|c| c.text())
                );
            }
            for slot in 0..count * 3 + 3 {
                assert_eq!(
                    map.get(&slot).map(Cell::text),
                    reference.get(&slot).map(Cell::text)
                );
                assert_eq!(map.contains_key(&slot), reference.contains_key(&slot));
            }
            let keys: Vec<usize> = map.iter().map(|(&k, _)| k).collect();
            assert_eq!(keys, reference.keys().copied().collect::<Vec<_>>());
            if let Some(&first) = reference.keys().next() {
                *map.get_mut(&first).unwrap() = Cell::Number(-1.0);
                assert_eq!(map.get(&first).unwrap().text(), "-1");
            }
            assert_eq!(map.iter().count(), reference.len());
            map.clear();
            assert!(map.iter().next().is_none() && map.get(&1).is_none());
        }
    }
}
