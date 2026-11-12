//! Out-of-line value evaluation; operand caching stays in eval_value_one.
use super::*;

impl Engine {
    #[cold]
    #[inline(never)]
    pub(super) fn eval_value_cold(&mut self, value: ValueExpr, actor: usize) -> Cell {
        match value {
            ValueExpr::ObjectLiteral(span) => self.eval_object_literal(span, actor),
            ValueExpr::ObjectKeys(object) => {
                let object = self.eval_value(object, actor);
                self.eval_object_keys(object)
            }
            ValueExpr::JsonParse(value) => {
                let value = self.eval_value(value, actor);
                self.eval_json_parse(value)
            }
            ValueExpr::JsonStringify(value) => {
                let value = self.eval_value(value, actor);
                self.eval_json_stringify(value)
            }
            ValueExpr::ObjectGet(object, key) => {
                let object = self.eval_value(object, actor);
                let key = self.eval_value(key, actor);
                self.eval_object_get(object, key)
            }
            ValueExpr::ObjectSet(object, key, value) => {
                let object = self.eval_value(object, actor);
                let key = self.eval_value(key, actor);
                let value = self.eval_value(value, actor);
                self.eval_object_set(object, key, value)
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
            ValueExpr::OfflineOcrCheck(i) => {
                // KN evaluates the query even when the OCR cache is absent.
                // No producer is supported in this explicit offline profile.
                let _ = self.eval_value(i, actor);
                Cell::Bool(false)
            }
            ValueExpr::OfflineMicrobitMap(args) => {
                // Official extension checks connectivity before its formula.
                // Socket evaluation still precedes the domain function call.
                // Evidence: docs/kn-microbit-map.md.
                for k in args.start..args.start + args.len {
                    let _ = self.eval_value(self.program.value_args[k as usize], actor);
                }
                Cell::Number(f64::NAN)
            }
            ValueExpr::OfflineMicrobitLed(args) => {
                // Official disconnected guard returns false, but sockets still
                // evaluate in panel order before the domain call. No LED backend.
                for i in args {
                    let _ = self.eval_value(i, actor);
                }
                Cell::Bool(false)
            }
            ValueExpr::Ranking(show) => Cell::Bool(show == self.cloud.ranking.is_some()),
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
                            32..=35 => Cell::Number(self.kn_property(
                                i,
                                actor,
                                match attribute {
                                    32 => kn_appearance::Property::Width,
                                    33 => kn_appearance::Property::Height,
                                    34 => kn_appearance::Property::Direction,
                                    _ => kn_appearance::Property::Style,
                                },
                            )),
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
                            // ASCII scope=7 is still an explicit unsupported
                            // effect; retain its default instead of indexing
                            // past the seven supported effect slots.
                            14 => Cell::Number(0.0),
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
            ValueExpr::KnCloneProperty(property) => {
                let property = self.program.kn_clone_properties[property as usize];
                self.eval_kn_clone_property(property, actor)
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
                        3 => a.camp.number(),
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
            ValueExpr::K4LegacyChoice => {
                self.value_error = Some(
                    if self.sprites[actor].stage {
                        "K4 choice used in scene"
                    } else {
                        "K4 legacy choice returned undefined"
                    }
                    .into(),
                );
                Cell::Null
            }
            ValueExpr::K4Media(reporter) => {
                let reporter = self.program.k4_media[reporter as usize];
                self.eval_k4_media(reporter, actor)
            }
            ValueExpr::KnPanel(reporter) => self.eval_kn_panel(reporter, actor),
            ValueExpr::K4Property(property) => {
                let property = self.program.k4_properties[property as usize];
                self.eval_k4_property(property, actor)
            }
            ValueExpr::K4DomainError(message) => {
                let message = self.eval_value(message, actor).text();
                self.value_error = Some(format!("K4 domain error: {message}"));
                Cell::Null
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
                let now = self
                    .virtual_epoch
                    .map_or_else(wall_time, |epoch| epoch + self.time);
                Cell::Text(DAYS[local_time(now, self.tz_offset_min)[4] as usize].into())
            }
            _ => unreachable!("hot value dispatched to eval_value_cold"),
        }
    }
}
