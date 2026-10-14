//! Rule configuration and evaluation, independent of the Shopify schema.
//!
//! The Function's two targets translate their GraphQL input into the plain
//! types here, call one of the `evaluate_*` functions, and translate the result
//! back into operations. Keeping the decision logic free of generated types
//! makes it testable on its own and keeps the targets thin.
//!
//! Every function here is total: bad configuration comes back as a
//! `ConfigError`, never a panic, because a panicking Function fails checkout's
//! discount calculation instead of simply not applying the discount.

use std::collections::BTreeMap;
use std::fmt;

use shopify_function::scalars::JsonValue;

/// The only config shape this Function understands. Bumped when the JSON
/// changes incompatibly, so an old Function never misreads a newer config.
pub const CONFIG_VERSION: f64 = 1.0;

/// Upper bound on tiers per rule. The admin UI enforces the same limit; this
/// is a backstop that keeps a hand-edited metafield from doing unbounded work.
pub const MAX_TIERS: usize = 10;

/// Tolerance for money comparisons, so a subtotal that lands a hair under a
/// threshold after currency conversion still counts as meeting it.
const MONEY_EPSILON: f64 = 1e-6;

/// One discount rule, parsed and validated from the discount's config metafield.
#[derive(Debug, Clone, PartialEq)]
pub enum Rule {
    /// Buy at least N items from the collections, get a percentage off those items.
    CollectionQuantityTiers {
        collection_ids: Vec<String>,
        tiers: Vec<Tier>,
    },
    /// Spend at least an amount, get a percentage off the order subtotal.
    CartSubtotalTiers { tiers: Vec<Tier> },
    /// Spend at least an amount, get free shipping.
    FreeShippingThreshold { min_subtotal: f64 },
}

/// A threshold and the percentage it unlocks. The threshold is an item count
/// or an amount in the shop's currency, depending on the rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tier {
    pub threshold: f64,
    pub percentage: f64,
}

/// Why a config could not be used. Logged by the Function, never shown to buyers.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfigError(String);

impl ConfigError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

// --- Parsing ------------------------------------------------------------------

/// Parses the discount's config metafield, treating a missing one as an error:
/// a TierDeals discount without its config has nothing to apply.
pub fn parse_configured_rule(metafield_value: Option<&JsonValue>) -> Result<Rule, ConfigError> {
    match metafield_value {
        Some(value) => parse_rule(value),
        None => Err(ConfigError::new(
            "the discount has no $app:tierdeals/rule-config metafield",
        )),
    }
}

/// Parses and validates a rule config.
///
/// Expected shapes (`version` is always 1):
///
/// ```json
/// { "version": 1, "type": "COLLECTION_QUANTITY_TIERS",
///   "collectionIds": ["gid://shopify/Collection/1"],
///   "tiers": [{ "minQuantity": 2, "percentage": 10 }] }
/// { "version": 1, "type": "CART_SUBTOTAL_TIERS",
///   "tiers": [{ "minSubtotal": 50, "percentage": 5 }] }
/// { "version": 1, "type": "FREE_SHIPPING_THRESHOLD", "minSubtotal": 75 }
/// ```
///
/// `collectionIds` is also read by Shopify as the `$collectionIds` input query
/// variable, which is why it sits at the top level.
pub fn parse_rule(value: &JsonValue) -> Result<Rule, ConfigError> {
    let JsonValue::Object(config) = value else {
        return Err(ConfigError::new("config must be a JSON object"));
    };

    match config.get("version") {
        Some(JsonValue::Number(version)) if *version == CONFIG_VERSION => {}
        Some(other) => {
            return Err(ConfigError::new(format!(
                "unsupported config version {other:?}, expected {CONFIG_VERSION}"
            )))
        }
        None => return Err(ConfigError::new("config is missing \"version\"")),
    }

    let rule_type = match config.get("type") {
        Some(JsonValue::String(rule_type)) => rule_type.as_str(),
        _ => return Err(ConfigError::new("config is missing a string \"type\"")),
    };

    match rule_type {
        "COLLECTION_QUANTITY_TIERS" => Ok(Rule::CollectionQuantityTiers {
            collection_ids: parse_collection_ids(config)?,
            tiers: parse_tiers(config, TierKind::Quantity)?,
        }),
        "CART_SUBTOTAL_TIERS" => Ok(Rule::CartSubtotalTiers {
            tiers: parse_tiers(config, TierKind::Subtotal)?,
        }),
        "FREE_SHIPPING_THRESHOLD" => Ok(Rule::FreeShippingThreshold {
            min_subtotal: parse_amount(config.get("minSubtotal"), "minSubtotal")?,
        }),
        other => Err(ConfigError::new(format!("unknown rule type {other:?}"))),
    }
}

#[derive(Clone, Copy)]
enum TierKind {
    Quantity,
    Subtotal,
}

impl TierKind {
    fn threshold_key(self) -> &'static str {
        match self {
            Self::Quantity => "minQuantity",
            Self::Subtotal => "minSubtotal",
        }
    }
}

fn parse_collection_ids(config: &BTreeMap<String, JsonValue>) -> Result<Vec<String>, ConfigError> {
    let Some(JsonValue::Array(items)) = config.get("collectionIds") else {
        return Err(ConfigError::new("\"collectionIds\" must be an array"));
    };
    if items.is_empty() {
        return Err(ConfigError::new("\"collectionIds\" must not be empty"));
    }

    items
        .iter()
        .map(|item| match item {
            JsonValue::String(id) if id.starts_with("gid://shopify/Collection/") => Ok(id.clone()),
            other => Err(ConfigError::new(format!(
                "\"collectionIds\" entries must be collection GIDs, got {other:?}"
            ))),
        })
        .collect()
}

fn parse_tiers(
    config: &BTreeMap<String, JsonValue>,
    kind: TierKind,
) -> Result<Vec<Tier>, ConfigError> {
    let Some(JsonValue::Array(items)) = config.get("tiers") else {
        return Err(ConfigError::new("\"tiers\" must be an array"));
    };
    if items.is_empty() || items.len() > MAX_TIERS {
        return Err(ConfigError::new(format!(
            "\"tiers\" must have between 1 and {MAX_TIERS} entries, got {}",
            items.len()
        )));
    }

    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            parse_tier(item, kind).map_err(|e| ConfigError::new(format!("tiers[{index}]: {e}")))
        })
        .collect()
}

fn parse_tier(item: &JsonValue, kind: TierKind) -> Result<Tier, ConfigError> {
    let JsonValue::Object(tier) = item else {
        return Err(ConfigError::new("must be an object"));
    };

    let key = kind.threshold_key();
    let threshold = match kind {
        TierKind::Quantity => parse_quantity(tier.get(key), key)?,
        TierKind::Subtotal => parse_amount(tier.get(key), key)?,
    };

    Ok(Tier {
        threshold,
        percentage: parse_percentage(tier.get("percentage"))?,
    })
}

fn parse_number(value: Option<&JsonValue>, key: &str) -> Result<f64, ConfigError> {
    match value {
        Some(JsonValue::Number(n)) if n.is_finite() => Ok(*n),
        _ => Err(ConfigError::new(format!(
            "\"{key}\" must be a finite number"
        ))),
    }
}

/// A whole number of items, at least 1.
fn parse_quantity(value: Option<&JsonValue>, key: &str) -> Result<f64, ConfigError> {
    let n = parse_number(value, key)?;
    if n < 1.0 || n.fract() != 0.0 {
        return Err(ConfigError::new(format!(
            "\"{key}\" must be a whole number of at least 1"
        )));
    }
    Ok(n)
}

/// A non-negative amount in the shop's currency.
fn parse_amount(value: Option<&JsonValue>, key: &str) -> Result<f64, ConfigError> {
    let n = parse_number(value, key)?;
    if n < 0.0 {
        return Err(ConfigError::new(format!("\"{key}\" must not be negative")));
    }
    Ok(n)
}

/// Greater than 0 and at most 100.
fn parse_percentage(value: Option<&JsonValue>) -> Result<f64, ConfigError> {
    let n = parse_number(value, "percentage")?;
    if n <= 0.0 || n > 100.0 {
        return Err(ConfigError::new(
            "\"percentage\" must be greater than 0 and at most 100",
        ));
    }
    Ok(n)
}

// --- Evaluation ---------------------------------------------------------------

/// The tier to apply for a measured `value`, if any.
///
/// Of the tiers whose threshold `value` meets, picks the one with the highest
/// percentage, so the result is the best deal for the buyer whatever order the
/// tiers were configured in. Tiers never stack: at most one applies.
pub fn best_tier(tiers: &[Tier], value: f64) -> Option<Tier> {
    tiers
        .iter()
        .copied()
        .filter(|tier| meets(value, tier.threshold))
        .max_by(|a, b| {
            a.percentage
                .total_cmp(&b.percentage)
                .then(a.threshold.total_cmp(&b.threshold))
        })
}

fn meets(value: f64, threshold: f64) -> bool {
    value + MONEY_EPSILON >= threshold
}

/// What the Function needs to know about one cart line for a collection rule.
#[derive(Debug, Clone, PartialEq)]
pub struct LineFacts {
    pub id: String,
    pub quantity: i64,
    pub in_collection: bool,
}

/// A percentage to apply to a set of cart lines.
#[derive(Debug, Clone, PartialEq)]
pub struct LineDiscount {
    pub tier: Tier,
    /// Items counted toward the tier: every unit in the collections.
    pub qualifying_quantity: i64,
    /// The lines the percentage applies to: exactly the qualifying ones.
    pub line_ids: Vec<String>,
}

/// Collection quantity tiers: counts every unit from the rule's collections
/// across all lines and, if a tier is met, discounts those lines.
pub fn evaluate_collection_quantity(tiers: &[Tier], lines: &[LineFacts]) -> Option<LineDiscount> {
    let qualifying: Vec<&LineFacts> = lines
        .iter()
        .filter(|line| line.in_collection && line.quantity > 0)
        .collect();
    let qualifying_quantity: i64 = qualifying.iter().map(|line| line.quantity).sum();

    let tier = best_tier(tiers, qualifying_quantity as f64)?;

    Some(LineDiscount {
        tier,
        qualifying_quantity,
        line_ids: qualifying.iter().map(|line| line.id.clone()).collect(),
    })
}

/// Cart subtotal tiers: the tier for a subtotal in the shop's currency.
pub fn evaluate_cart_subtotal(tiers: &[Tier], subtotal: f64) -> Option<Tier> {
    best_tier(tiers, subtotal)
}

/// Free shipping threshold: whether a subtotal in the shop's currency qualifies.
pub fn qualifies_for_free_shipping(min_subtotal: f64, subtotal: f64) -> bool {
    meets(subtotal, min_subtotal)
}

/// Converts an amount in the buyer's (presentment) currency into the shop's
/// currency, which is what rule thresholds are configured in.
///
/// Returns `None` for a rate that cannot be divided by, so callers skip the
/// discount instead of comparing against a nonsense amount.
pub fn to_shop_currency(presentment_amount: f64, presentment_currency_rate: f64) -> Option<f64> {
    if presentment_currency_rate.is_finite() && presentment_currency_rate > 0.0 {
        Some(presentment_amount / presentment_currency_rate)
    } else {
        None
    }
}

/// Formats a percentage or item count for a buyer-facing message: `15` or
/// `12.5`, not `15.0`.
pub fn format_number(n: f64) -> String {
    format!("{n}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(entries: Vec<(&str, JsonValue)>) -> JsonValue {
        JsonValue::Object(
            entries
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        )
    }

    fn num(n: f64) -> JsonValue {
        JsonValue::Number(n)
    }

    fn string(s: &str) -> JsonValue {
        JsonValue::String(s.to_string())
    }

    fn quantity_tier(min: f64, percentage: f64) -> JsonValue {
        obj(vec![
            ("minQuantity", num(min)),
            ("percentage", num(percentage)),
        ])
    }

    fn subtotal_tier(min: f64, percentage: f64) -> JsonValue {
        obj(vec![
            ("minSubtotal", num(min)),
            ("percentage", num(percentage)),
        ])
    }

    fn collection_config(tiers: Vec<JsonValue>) -> JsonValue {
        obj(vec![
            ("version", num(1.0)),
            ("type", string("COLLECTION_QUANTITY_TIERS")),
            (
                "collectionIds",
                JsonValue::Array(vec![string("gid://shopify/Collection/1")]),
            ),
            ("tiers", JsonValue::Array(tiers)),
        ])
    }

    fn tier(threshold: f64, percentage: f64) -> Tier {
        Tier {
            threshold,
            percentage,
        }
    }

    fn line(id: &str, quantity: i64, in_collection: bool) -> LineFacts {
        LineFacts {
            id: id.to_string(),
            quantity,
            in_collection,
        }
    }

    // --- parse_rule: valid configs ---------------------------------------------

    #[test]
    fn parses_collection_quantity_tiers() {
        let rule = parse_rule(&collection_config(vec![
            quantity_tier(2.0, 10.0),
            quantity_tier(3.0, 15.0),
        ]))
        .unwrap();

        assert_eq!(
            rule,
            Rule::CollectionQuantityTiers {
                collection_ids: vec!["gid://shopify/Collection/1".to_string()],
                tiers: vec![tier(2.0, 10.0), tier(3.0, 15.0)],
            }
        );
    }

    #[test]
    fn parses_cart_subtotal_tiers() {
        let config = obj(vec![
            ("version", num(1.0)),
            ("type", string("CART_SUBTOTAL_TIERS")),
            ("tiers", JsonValue::Array(vec![subtotal_tier(50.0, 5.0)])),
        ]);

        assert_eq!(
            parse_rule(&config).unwrap(),
            Rule::CartSubtotalTiers {
                tiers: vec![tier(50.0, 5.0)]
            }
        );
    }

    #[test]
    fn parses_free_shipping_threshold() {
        let config = obj(vec![
            ("version", num(1.0)),
            ("type", string("FREE_SHIPPING_THRESHOLD")),
            ("minSubtotal", num(75.0)),
        ]);

        assert_eq!(
            parse_rule(&config).unwrap(),
            Rule::FreeShippingThreshold { min_subtotal: 75.0 }
        );
    }

    #[test]
    fn ignores_unknown_keys() {
        let JsonValue::Object(mut config) = collection_config(vec![quantity_tier(2.0, 10.0)])
        else {
            unreachable!()
        };
        config.insert("note".to_string(), string("added by a newer admin UI"));

        assert!(parse_rule(&JsonValue::Object(config)).is_ok());
    }

    // --- parse_rule: malformed configs -----------------------------------------

    fn assert_rejected(config: JsonValue, expected_fragment: &str) {
        let error = parse_rule(&config).expect_err("config should be rejected");
        assert!(
            error.to_string().contains(expected_fragment),
            "error {error:?} should mention {expected_fragment:?}"
        );
    }

    #[test]
    fn rejects_non_object_config() {
        assert_rejected(JsonValue::Null, "JSON object");
        assert_rejected(string("{}"), "JSON object");
        assert_rejected(JsonValue::Array(vec![]), "JSON object");
    }

    #[test]
    fn rejects_missing_or_unsupported_version() {
        assert_rejected(
            obj(vec![("type", string("CART_SUBTOTAL_TIERS"))]),
            "missing \"version\"",
        );
        assert_rejected(
            obj(vec![
                ("version", num(2.0)),
                ("type", string("CART_SUBTOTAL_TIERS")),
            ]),
            "unsupported config version",
        );
    }

    #[test]
    fn rejects_unknown_or_missing_type() {
        assert_rejected(
            obj(vec![("version", num(1.0)), ("type", string("BOGO"))]),
            "unknown rule type",
        );
        assert_rejected(obj(vec![("version", num(1.0))]), "\"type\"");
    }

    #[test]
    fn rejects_missing_or_empty_tiers() {
        let mut config = collection_config(vec![]);
        assert_rejected(config.clone(), "between 1 and 10");

        if let JsonValue::Object(map) = &mut config {
            map.remove("tiers");
        }
        assert_rejected(config, "\"tiers\" must be an array");
    }

    #[test]
    fn rejects_too_many_tiers() {
        let tiers = (1..=11).map(|n| quantity_tier(n as f64, 5.0)).collect();
        assert_rejected(collection_config(tiers), "between 1 and 10");
    }

    #[test]
    fn rejects_bad_tier_values() {
        assert_rejected(
            collection_config(vec![quantity_tier(0.0, 10.0)]),
            "tiers[0]: \"minQuantity\" must be a whole number",
        );
        assert_rejected(
            collection_config(vec![quantity_tier(2.5, 10.0)]),
            "whole number",
        );
        assert_rejected(
            collection_config(vec![quantity_tier(2.0, 0.0)]),
            "greater than 0",
        );
        assert_rejected(
            collection_config(vec![quantity_tier(2.0, 10.0), quantity_tier(3.0, 101.0)]),
            "tiers[1]: \"percentage\"",
        );
        assert_rejected(
            collection_config(vec![obj(vec![
                ("minQuantity", string("2")),
                ("percentage", num(10.0)),
            ])]),
            "finite number",
        );
        assert_rejected(collection_config(vec![num(2.0)]), "must be an object");
    }

    #[test]
    fn rejects_negative_amounts() {
        assert_rejected(
            obj(vec![
                ("version", num(1.0)),
                ("type", string("FREE_SHIPPING_THRESHOLD")),
                ("minSubtotal", num(-1.0)),
            ]),
            "must not be negative",
        );
    }

    #[test]
    fn rejects_bad_collection_ids() {
        let with_ids = |ids: JsonValue| {
            obj(vec![
                ("version", num(1.0)),
                ("type", string("COLLECTION_QUANTITY_TIERS")),
                ("collectionIds", ids),
                ("tiers", JsonValue::Array(vec![quantity_tier(2.0, 10.0)])),
            ])
        };

        assert_rejected(with_ids(JsonValue::Array(vec![])), "must not be empty");
        assert_rejected(
            with_ids(string("gid://shopify/Collection/1")),
            "must be an array",
        );
        assert_rejected(
            with_ids(JsonValue::Array(vec![string("gid://shopify/Product/1")])),
            "collection GIDs",
        );
    }

    // --- best_tier -------------------------------------------------------------

    #[test]
    fn best_tier_picks_the_highest_tier_met() {
        let tiers = [tier(2.0, 10.0), tier(3.0, 15.0), tier(5.0, 25.0)];

        assert_eq!(best_tier(&tiers, 1.0), None);
        assert_eq!(best_tier(&tiers, 2.0), Some(tier(2.0, 10.0)));
        assert_eq!(best_tier(&tiers, 4.0), Some(tier(3.0, 15.0)));
        assert_eq!(best_tier(&tiers, 5.0), Some(tier(5.0, 25.0)));
        assert_eq!(best_tier(&tiers, 50.0), Some(tier(5.0, 25.0)));
    }

    #[test]
    fn best_tier_does_not_depend_on_tier_order() {
        let tiers = [tier(5.0, 25.0), tier(2.0, 10.0), tier(3.0, 15.0)];

        assert_eq!(best_tier(&tiers, 4.0), Some(tier(3.0, 15.0)));
    }

    #[test]
    fn best_tier_prefers_the_bigger_percentage_when_tiers_are_inverted() {
        // A misconfigured rule where a higher threshold gives less: the buyer
        // still gets the better deal they qualify for.
        let tiers = [tier(2.0, 20.0), tier(5.0, 10.0)];

        assert_eq!(best_tier(&tiers, 6.0), Some(tier(2.0, 20.0)));
    }

    #[test]
    fn best_tier_with_no_tiers_is_none() {
        assert_eq!(best_tier(&[], 100.0), None);
    }

    // --- evaluate_collection_quantity -----------------------------------------

    #[test]
    fn collection_quantity_counts_units_across_lines() {
        let tiers = [tier(3.0, 15.0)];
        let lines = [line("a", 2, true), line("b", 1, true), line("c", 4, false)];

        assert_eq!(
            evaluate_collection_quantity(&tiers, &lines),
            Some(LineDiscount {
                tier: tier(3.0, 15.0),
                qualifying_quantity: 3,
                line_ids: vec!["a".to_string(), "b".to_string()],
            })
        );
    }

    #[test]
    fn collection_quantity_applies_exactly_at_the_threshold() {
        let lines = [line("a", 3, true)];

        assert!(evaluate_collection_quantity(&[tier(3.0, 15.0)], &lines).is_some());
    }

    #[test]
    fn collection_quantity_does_not_apply_one_below_the_threshold() {
        let lines = [line("a", 2, true), line("b", 5, false)];

        assert_eq!(
            evaluate_collection_quantity(&[tier(3.0, 15.0)], &lines),
            None
        );
    }

    #[test]
    fn collection_quantity_with_an_empty_cart_is_none() {
        assert_eq!(evaluate_collection_quantity(&[tier(1.0, 10.0)], &[]), None);
    }

    // --- evaluate_cart_subtotal ------------------------------------------------

    #[test]
    fn cart_subtotal_tiers_apply_at_and_above_the_threshold() {
        let tiers = [tier(50.0, 5.0), tier(100.0, 10.0)];

        assert_eq!(evaluate_cart_subtotal(&tiers, 49.99), None);
        assert_eq!(evaluate_cart_subtotal(&tiers, 50.0), Some(tier(50.0, 5.0)));
        assert_eq!(evaluate_cart_subtotal(&tiers, 99.99), Some(tier(50.0, 5.0)));
        assert_eq!(
            evaluate_cart_subtotal(&tiers, 100.0),
            Some(tier(100.0, 10.0))
        );
    }

    #[test]
    fn cart_subtotal_of_an_empty_cart_is_none() {
        assert_eq!(evaluate_cart_subtotal(&[tier(50.0, 5.0)], 0.0), None);
    }

    // --- qualifies_for_free_shipping -------------------------------------------

    #[test]
    fn free_shipping_applies_at_and_above_the_threshold() {
        assert!(!qualifies_for_free_shipping(75.0, 74.99));
        assert!(qualifies_for_free_shipping(75.0, 75.0));
        assert!(qualifies_for_free_shipping(75.0, 200.0));
    }

    #[test]
    fn free_shipping_with_a_zero_threshold_always_applies() {
        assert!(qualifies_for_free_shipping(0.0, 0.0));
    }

    // --- currency --------------------------------------------------------------

    #[test]
    fn converts_presentment_amounts_to_shop_currency() {
        assert_eq!(to_shop_currency(150.0, 1.5), Some(100.0));
        assert_eq!(to_shop_currency(100.0, 1.0), Some(100.0));
    }

    #[test]
    fn refuses_unusable_currency_rates() {
        assert_eq!(to_shop_currency(100.0, 0.0), None);
        assert_eq!(to_shop_currency(100.0, -1.0), None);
        assert_eq!(to_shop_currency(100.0, f64::NAN), None);
    }

    #[test]
    fn a_converted_subtotal_just_under_the_threshold_by_rounding_still_qualifies() {
        // 110.0 / 1.1 is 99.99999999999999 in f64.
        let subtotal = to_shop_currency(110.0, 1.1).unwrap();

        assert!(subtotal < 100.0);
        assert!(qualifies_for_free_shipping(100.0, subtotal));
    }

    #[test]
    fn formats_numbers_without_trailing_zeros() {
        assert_eq!(format_number(15.0), "15");
        assert_eq!(format_number(12.5), "12.5");
    }

    #[test]
    fn a_missing_metafield_is_a_config_error() {
        let error = parse_configured_rule(None).unwrap_err();

        assert!(error.to_string().contains("rule-config metafield"));
    }
}
