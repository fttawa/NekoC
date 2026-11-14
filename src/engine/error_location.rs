//! Evaluator errors cross reporter boundaries as text. Keep the innermost
//! instruction's location instead of appending every recursive caller's block.
pub(super) fn at_block(error: &str, block: &str) -> String {
    if error.contains(" at block ") {
        error.to_owned()
    } else {
        format!("{error} at block {block}")
    }
}

#[cfg(test)]
mod tests {
    use super::at_block;

    #[test]
    fn preserves_the_first_location_even_for_distinct_recursive_call_sites() {
        let first = at_block("reporter procedure recursion exceeds 200", "inner");
        assert_eq!(at_block(&first, "outer"), first);
        assert_eq!(at_block(&first, "inner"), first);
    }
}
