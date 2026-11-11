//! Actor groups: K4 stores arbitrary strings, unlike KN's four numeric camps.
use super::{Compiler, RuntimeSemantics, TARGET_CAMP, camp_code, camp_target};

pub(super) fn is_camp_target(target: usize) -> bool {
    (usize::MAX / 2..=TARGET_CAMP).contains(&target)
}

impl Compiler {
    pub(super) fn role_camp_target(&mut self, id: &str) -> Option<usize> {
        if self.program.semantics == RuntimeSemantics::Kitten4 && id.contains("camp") {
            if id != "camp_green"
                && let Some(target) = camp_target(id)
            {
                return Some(target);
            }
            let index = self.program.strings.len();
            self.program.strings.push(id.into());
            Some(TARGET_CAMP - 4 - index)
        } else {
            camp_target(id)
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum RoleCamp {
    Unset,
    Standard(u8),
    Custom(String),
}

impl RoleCamp {
    pub(super) fn new(id: &str, semantics: RuntimeSemantics) -> Self {
        // K4's green editor option is named camp_yellow. camp_green is only
        // a KN alias; treating it as yellow (or no_camp) changes collisions.
        match camp_code(id) {
            Some(code) if semantics != RuntimeSemantics::Kitten4 || id != "camp_green" => {
                Self::Standard(code)
            }
            _ if semantics == RuntimeSemantics::Kitten4 => Self::Custom(id.into()),
            _ => Self::Standard(0),
        }
    }

    pub(super) fn is_standard(&self, code: u8) -> bool {
        matches!(self, Self::Standard(c) if *c == code)
    }

    pub(super) fn number(&self) -> f64 {
        match self {
            Self::Standard(code) => f64::from(*code),
            Self::Custom(_) | Self::Unset => f64::NAN,
        }
    }

    pub(super) fn id(&self) -> Option<&str> {
        Some(match self {
            Self::Unset => return None,
            Self::Standard(0) => "no_camp",
            Self::Standard(1) => "camp_red",
            Self::Standard(2) => "camp_yellow",
            Self::Standard(_) => "camp_blue",
            Self::Custom(id) => id,
        })
    }
}
