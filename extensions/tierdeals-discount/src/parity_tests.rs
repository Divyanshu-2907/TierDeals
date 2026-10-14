//! Runs every case in /fixtures/rules through the Function's own
//! `parse_rule` and `evaluate`. The admin's TypeScript evaluator runs the
//! same files (web/shared/test/parity.test.ts), so a case that passes here
//! but not there, or the other way round, means the two have drifted.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use shopify_function::scalars::JsonValue;

use crate::rule::{self, CartFacts, Decision, LineFacts, NotApplied};

/// Same tolerance the evaluators use for threshold comparisons.
const TOLERANCE: f64 = 1e-6;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/rules")
}

/// Every fixture file under `dir`, recursively, sorted for stable output.
fn fixture_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).expect("fixtures directory should exist") {
        let path = entry.expect("readable directory entry").path();
        if path.is_dir() {
            files.extend(fixture_files(&path));
        } else if path.extension().is_some_and(|ext| ext == "json") {
            files.push(path);
        }
    }
    files.sort();
    files
}

fn to_json_value(value: &Value) -> JsonValue {
    match value {
        Value::Null => JsonValue::Null,
        Value::Bool(b) => JsonValue::Boolean(*b),
        Value::Number(n) => JsonValue::Number(n.as_f64().expect("finite number")),
        Value::String(s) => JsonValue::String(s.clone()),
        Value::Array(items) => JsonValue::Array(items.iter().map(to_json_value).collect()),
        Value::Object(map) => JsonValue::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), to_json_value(value)))
                .collect::<BTreeMap<_, _>>(),
        ),
    }
}

fn cart_facts(cart: &Value) -> CartFacts {
    CartFacts {
        lines: cart["lines"]
            .as_array()
            .expect("cart.lines")
            .iter()
            .map(|line| LineFacts {
                id: line["id"].as_str().expect("line.id").to_string(),
                quantity: line["quantity"].as_i64().expect("line.quantity"),
                in_collection: line["inCollection"].as_bool().expect("line.inCollection"),
            })
            .collect(),
        subtotal: cart["subtotal"].as_f64().expect("cart.subtotal"),
        presentment_currency_rate: cart["presentmentCurrencyRate"]
            .as_f64()
            .expect("cart.presentmentCurrencyRate"),
    }
}

/// The decision in the fixtures' JSON shape (see fixtures/README.md).
fn decision_json(config: &JsonValue, cart: &CartFacts) -> Value {
    let rule = match rule::parse_rule(config) {
        Ok(rule) => rule,
        Err(_) => return json!({ "decision": "invalid_config" }),
    };

    match rule::evaluate(&rule, cart) {
        Decision::ProductDiscount(discount) => json!({
            "decision": "product_discount",
            "percentage": discount.tier.percentage,
            "threshold": discount.tier.threshold,
            "qualifyingQuantity": discount.qualifying_quantity,
            "lineIds": discount.line_ids,
        }),
        Decision::OrderDiscount { tier, subtotal } => json!({
            "decision": "order_discount",
            "percentage": tier.percentage,
            "threshold": tier.threshold,
            "subtotal": subtotal,
        }),
        Decision::FreeShipping { subtotal } => json!({
            "decision": "free_shipping",
            "subtotal": subtotal,
        }),
        Decision::NotApplied(NotApplied::BelowThreshold { measured }) => json!({
            "decision": "not_applied",
            "reason": "below_threshold",
            "measured": measured,
        }),
        Decision::NotApplied(NotApplied::InvalidCurrencyRate) => json!({
            "decision": "not_applied",
            "reason": "invalid_currency_rate",
        }),
    }
}

/// Structural equality with a numeric tolerance.
fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() <= TOLERANCE
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| matches(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| matches(value, other)))
        }
        _ => actual == expected,
    }
}

#[test]
fn every_shared_fixture_reaches_the_expected_decision() {
    let files = fixture_files(&fixtures_dir());
    assert!(
        files.len() >= 30,
        "expected the shared fixtures in {:?}, found {}",
        fixtures_dir(),
        files.len()
    );

    let mut failures = Vec::new();
    for file in &files {
        let fixture: Value =
            serde_json::from_str(&fs::read_to_string(file).expect("readable fixture"))
                .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", file.display()));

        let actual = decision_json(
            &to_json_value(&fixture["config"]),
            &cart_facts(&fixture["cart"]),
        );
        if !matches(&actual, &fixture["expected"]) {
            failures.push(format!(
                "{}\n    expected {}\n    actual   {}",
                file.display(),
                fixture["expected"],
                actual
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} fixtures failed:\n{}",
        failures.len(),
        files.len(),
        failures.join("\n")
    );
}
