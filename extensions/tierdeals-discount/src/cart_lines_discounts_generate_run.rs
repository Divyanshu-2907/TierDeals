//! `cart.lines.discounts.generate.run`: product and order discounts.
//!
//! Collection quantity tiers become a product discount on the qualifying
//! lines; cart subtotal tiers become an order discount. Anything else, or a
//! config that does not parse, produces no operations.

use super::schema;
use crate::rule::{self, LineFacts, Rule, Tier};
use shopify_function::prelude::*;
use shopify_function::Result;

use schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise;
use schema::cart_lines_discounts_generate_run::Input;

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: operations(&input),
    })
}

fn operations(input: &Input) -> Vec<schema::CartOperation> {
    let config = input
        .discount()
        .rule_config()
        .map(|metafield| metafield.json_value());

    let rule = match rule::parse_configured_rule(config) {
        Ok(rule) => rule,
        Err(error) => {
            log!("TierDeals: not applying discount: {error}");
            return vec![];
        }
    };

    let classes = input.discount().discount_classes();

    let operation = match rule {
        Rule::CollectionQuantityTiers { tiers, .. }
            if classes.contains(&schema::DiscountClass::Product) =>
        {
            product_discount(input, &tiers)
        }
        Rule::CartSubtotalTiers { tiers } if classes.contains(&schema::DiscountClass::Order) => {
            order_discount(input, &tiers)
        }
        // A shipping rule, or a rule whose class the discount was not created with.
        _ => None,
    };

    operation.into_iter().collect()
}

fn product_discount(input: &Input, tiers: &[Tier]) -> Option<schema::CartOperation> {
    let lines: Vec<LineFacts> = input
        .cart()
        .lines()
        .iter()
        .map(|line| LineFacts {
            id: line.id().clone(),
            quantity: i64::from(*line.quantity()),
            in_collection: match line.merchandise() {
                Merchandise::ProductVariant(variant) => *variant.product().in_rule_collection(),
                _ => false,
            },
        })
        .collect();

    let discount = rule::evaluate_collection_quantity(tiers, &lines)?;

    Some(schema::CartOperation::ProductDiscountsAdd(
        schema::ProductDiscountsAddOperation {
            selection_strategy: schema::ProductDiscountSelectionStrategy::First,
            candidates: vec![schema::ProductDiscountCandidate {
                targets: discount
                    .line_ids
                    .into_iter()
                    .map(|id| {
                        schema::ProductDiscountCandidateTarget::CartLine(schema::CartLineTarget {
                            id,
                            quantity: None,
                        })
                    })
                    .collect(),
                message: Some(format!(
                    "Buy {}+, save {}%",
                    rule::format_number(discount.tier.threshold),
                    rule::format_number(discount.tier.percentage)
                )),
                value: schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                    value: Decimal(discount.tier.percentage),
                }),
                associated_discount_code: None,
                prerequisites: None,
            }],
        },
    ))
}

fn order_discount(input: &Input, tiers: &[Tier]) -> Option<schema::CartOperation> {
    let presentment_subtotal = input.cart().cost().subtotal_amount().amount().as_f64();
    let Some(subtotal) = rule::to_shop_currency(
        presentment_subtotal,
        input.presentment_currency_rate().as_f64(),
    ) else {
        log!("TierDeals: not applying discount: unusable presentment currency rate");
        return None;
    };

    let tier = rule::evaluate_cart_subtotal(tiers, subtotal)?;

    Some(schema::CartOperation::OrderDiscountsAdd(
        schema::OrderDiscountsAddOperation {
            selection_strategy: schema::OrderDiscountSelectionStrategy::First,
            candidates: vec![schema::OrderDiscountCandidate {
                targets: vec![schema::OrderDiscountCandidateTarget::OrderSubtotal(
                    schema::OrderSubtotalTarget {
                        excluded_cart_line_ids: vec![],
                    },
                )],
                message: Some(format!(
                    "{}% off your order",
                    rule::format_number(tier.percentage)
                )),
                value: schema::OrderDiscountCandidateValue::Percentage(schema::Percentage {
                    value: Decimal(tier.percentage),
                }),
                conditions: None,
                associated_discount_code: None,
            }],
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use shopify_function::run_function_with_input;

    /// What the Function decided, flattened so tests read as intent.
    #[derive(Debug, PartialEq)]
    enum Applied {
        Product {
            percentage: f64,
            line_ids: Vec<String>,
            message: String,
        },
        Order {
            percentage: f64,
            message: String,
        },
    }

    fn run(input: Value) -> Vec<Applied> {
        let result = run_function_with_input(cart_lines_discounts_generate_run, &input.to_string())
            .expect("the function should not error");

        result
            .operations
            .into_iter()
            .flat_map(|operation| match operation {
                schema::CartOperation::ProductDiscountsAdd(op) => op
                    .candidates
                    .into_iter()
                    .map(|candidate| {
                        let schema::ProductDiscountCandidateValue::Percentage(value) =
                            candidate.value
                        else {
                            panic!("expected a percentage")
                        };
                        Applied::Product {
                            percentage: value.value.as_f64(),
                            line_ids: candidate
                                .targets
                                .into_iter()
                                .map(|target| {
                                    let schema::ProductDiscountCandidateTarget::CartLine(line) =
                                        target;
                                    line.id
                                })
                                .collect(),
                            message: candidate.message.unwrap_or_default(),
                        }
                    })
                    .collect::<Vec<_>>(),
                schema::CartOperation::OrderDiscountsAdd(op) => op
                    .candidates
                    .into_iter()
                    .map(|candidate| {
                        let schema::OrderDiscountCandidateValue::Percentage(value) =
                            candidate.value
                        else {
                            panic!("expected a percentage")
                        };
                        Applied::Order {
                            percentage: value.value.as_f64(),
                            message: candidate.message.unwrap_or_default(),
                        }
                    })
                    .collect(),
                other => panic!("unexpected operation {other:?}"),
            })
            .collect()
    }

    fn variant_line(id: &str, quantity: i64, in_collection: bool) -> Value {
        json!({
            "id": format!("gid://shopify/CartLine/{id}"),
            "quantity": quantity,
            "merchandise": {
                "__typename": "ProductVariant",
                "product": { "inRuleCollection": in_collection }
            }
        })
    }

    fn input(config: Value, classes: &[&str], lines: Vec<Value>, subtotal: &str) -> Value {
        input_with_rate(config, classes, lines, subtotal, "1.0")
    }

    fn input_with_rate(
        config: Value,
        classes: &[&str],
        lines: Vec<Value>,
        subtotal: &str,
        rate: &str,
    ) -> Value {
        let rule_config = if config.is_null() {
            Value::Null
        } else {
            json!({ "jsonValue": config })
        };

        json!({
            "cart": {
                "lines": lines,
                "cost": { "subtotalAmount": { "amount": subtotal } }
            },
            "discount": {
                "discountClasses": classes,
                "ruleConfig": rule_config
            },
            "presentmentCurrencyRate": rate
        })
    }

    fn collection_rule() -> Value {
        json!({
            "version": 1,
            "type": "COLLECTION_QUANTITY_TIERS",
            "collectionIds": ["gid://shopify/Collection/1"],
            "tiers": [
                { "minQuantity": 2, "percentage": 10 },
                { "minQuantity": 3, "percentage": 15 },
                { "minQuantity": 5, "percentage": 25 }
            ]
        })
    }

    fn subtotal_rule() -> Value {
        json!({
            "version": 1,
            "type": "CART_SUBTOTAL_TIERS",
            "tiers": [
                { "minSubtotal": 50, "percentage": 5 },
                { "minSubtotal": 100, "percentage": 10 }
            ]
        })
    }

    // --- collection quantity tiers ---------------------------------------------

    #[test]
    fn discounts_only_the_collection_lines_at_the_best_tier() {
        let applied = run(input(
            collection_rule(),
            &["PRODUCT"],
            vec![
                variant_line("1", 2, true),
                variant_line("2", 1, true),
                variant_line("3", 4, false),
            ],
            "120.0",
        ));

        assert_eq!(
            applied,
            vec![Applied::Product {
                percentage: 15.0,
                line_ids: vec![
                    "gid://shopify/CartLine/1".to_string(),
                    "gid://shopify/CartLine/2".to_string()
                ],
                message: "Buy 3+, save 15%".to_string(),
            }]
        );
    }

    #[test]
    fn applies_exactly_at_the_lowest_threshold() {
        let applied = run(input(
            collection_rule(),
            &["PRODUCT"],
            vec![variant_line("1", 2, true)],
            "40.0",
        ));

        assert!(matches!(
            applied.as_slice(),
            [Applied::Product { percentage, .. }] if *percentage == 10.0
        ));
    }

    #[test]
    fn does_nothing_one_below_the_lowest_threshold() {
        let applied = run(input(
            collection_rule(),
            &["PRODUCT"],
            vec![variant_line("1", 1, true), variant_line("2", 9, false)],
            "200.0",
        ));

        assert_eq!(applied, vec![]);
    }

    #[test]
    fn does_not_count_custom_products() {
        let custom = json!({
            "id": "gid://shopify/CartLine/2",
            "quantity": 5,
            "merchandise": { "__typename": "CustomProduct" }
        });

        let applied = run(input(
            collection_rule(),
            &["PRODUCT"],
            vec![variant_line("1", 1, true), custom],
            "60.0",
        ));

        assert_eq!(applied, vec![]);
    }

    #[test]
    fn needs_the_product_discount_class() {
        let applied = run(input(
            collection_rule(),
            &["ORDER", "SHIPPING"],
            vec![variant_line("1", 5, true)],
            "100.0",
        ));

        assert_eq!(applied, vec![]);
    }

    // --- cart subtotal tiers ---------------------------------------------------

    #[test]
    fn discounts_the_order_at_the_best_subtotal_tier() {
        let applied = run(input(
            subtotal_rule(),
            &["ORDER"],
            vec![variant_line("1", 1, false)],
            "100.0",
        ));

        assert_eq!(
            applied,
            vec![Applied::Order {
                percentage: 10.0,
                message: "10% off your order".to_string(),
            }]
        );
    }

    #[test]
    fn does_nothing_just_below_the_lowest_subtotal_tier() {
        let applied = run(input(
            subtotal_rule(),
            &["ORDER"],
            vec![variant_line("1", 1, false)],
            "49.99",
        ));

        assert_eq!(applied, vec![]);
    }

    #[test]
    fn compares_the_subtotal_in_the_shop_currency() {
        // 75.00 in the buyer's currency at a rate of 1.5 is 50.00 in the shop's.
        let applied = run(input_with_rate(
            subtotal_rule(),
            &["ORDER"],
            vec![variant_line("1", 1, false)],
            "75.0",
            "1.5",
        ));

        assert!(matches!(
            applied.as_slice(),
            [Applied::Order { percentage, .. }] if *percentage == 5.0
        ));
    }

    #[test]
    fn needs_the_order_discount_class() {
        let applied = run(input(
            subtotal_rule(),
            &["PRODUCT"],
            vec![variant_line("1", 1, false)],
            "500.0",
        ));

        assert_eq!(applied, vec![]);
    }

    // --- everything that should apply nothing ---------------------------------

    #[test]
    fn does_nothing_for_an_empty_cart() {
        assert_eq!(
            run(input(collection_rule(), &["PRODUCT"], vec![], "0.0")),
            vec![]
        );
        assert_eq!(
            run(input(subtotal_rule(), &["ORDER"], vec![], "0.0")),
            vec![]
        );
    }

    #[test]
    fn does_nothing_without_a_config_metafield() {
        let applied = run(input(
            Value::Null,
            &["PRODUCT", "ORDER"],
            vec![variant_line("1", 10, true)],
            "500.0",
        ));

        assert_eq!(applied, vec![]);
    }

    #[test]
    fn does_nothing_for_a_malformed_config() {
        for config in [
            json!("not an object"),
            json!({ "version": 1, "type": "COLLECTION_QUANTITY_TIERS" }),
            json!({ "version": 1, "type": "CART_SUBTOTAL_TIERS", "tiers": [{ "minSubtotal": "50", "percentage": 5 }] }),
            json!({ "version": 99, "type": "CART_SUBTOTAL_TIERS", "tiers": [] }),
        ] {
            let applied = run(input(
                config.clone(),
                &["PRODUCT", "ORDER"],
                vec![variant_line("1", 10, true)],
                "500.0",
            ));

            assert_eq!(applied, vec![], "config {config} should apply nothing");
        }
    }

    #[test]
    fn leaves_shipping_rules_to_the_delivery_target() {
        let applied = run(input(
            json!({ "version": 1, "type": "FREE_SHIPPING_THRESHOLD", "minSubtotal": 10 }),
            &["PRODUCT", "ORDER", "SHIPPING"],
            vec![variant_line("1", 10, true)],
            "500.0",
        ));

        assert_eq!(applied, vec![]);
    }

    #[test]
    fn does_nothing_for_an_unusable_currency_rate() {
        let applied = run(input_with_rate(
            subtotal_rule(),
            &["ORDER"],
            vec![variant_line("1", 1, false)],
            "500.0",
            "0.0",
        ));

        assert_eq!(applied, vec![]);
    }
}
