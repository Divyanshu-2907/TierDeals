//! `cart.delivery-options.discounts.generate.run`: shipping discounts.
//!
//! A free shipping threshold that the cart meets makes every delivery group
//! free. The decision itself is `rule::evaluate`'s. Anything else, or a
//! config that does not parse, produces no operations.

use super::schema;
use crate::rule::{self, CartFacts, Decision, NotApplied, Rule};
use shopify_function::prelude::*;
use shopify_function::Result;

use schema::cart_delivery_options_discounts_generate_run::Input;

#[shopify_function]
fn cart_delivery_options_discounts_generate_run(
    input: Input,
) -> Result<schema::CartDeliveryOptionsDiscountsGenerateRunResult> {
    Ok(schema::CartDeliveryOptionsDiscountsGenerateRunResult {
        operations: operations(&input),
    })
}

fn operations(input: &Input) -> Vec<schema::DeliveryOperation> {
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

    // Product and order rules belong to the cart lines target.
    if !matches!(rule, Rule::FreeShippingThreshold { .. })
        || !input
            .discount()
            .discount_classes()
            .contains(&schema::DiscountClass::Shipping)
    {
        return vec![];
    }

    let facts = CartFacts {
        // The free shipping rule only looks at the subtotal.
        lines: vec![],
        subtotal: input.cart().cost().subtotal_amount().amount().as_f64(),
        presentment_currency_rate: input.presentment_currency_rate().as_f64(),
    };

    match rule::evaluate(&rule, &facts) {
        Decision::FreeShipping { .. } => free_shipping_operation(input).into_iter().collect(),
        Decision::NotApplied(NotApplied::InvalidCurrencyRate) => {
            log!("TierDeals: not applying discount: unusable presentment currency rate");
            vec![]
        }
        _ => vec![],
    }
}

fn free_shipping_operation(input: &Input) -> Option<schema::DeliveryOperation> {
    let targets: Vec<_> = input
        .cart()
        .delivery_groups()
        .iter()
        .map(|group| {
            schema::DeliveryDiscountCandidateTarget::DeliveryGroup(schema::DeliveryGroupTarget {
                id: group.id().clone(),
            })
        })
        .collect();

    // No delivery groups yet (no address entered): nothing to discount.
    if targets.is_empty() {
        return None;
    }

    Some(schema::DeliveryOperation::DeliveryDiscountsAdd(
        schema::DeliveryDiscountsAddOperation {
            selection_strategy: schema::DeliveryDiscountSelectionStrategy::All,
            candidates: vec![schema::DeliveryDiscountCandidate {
                targets,
                value: schema::DeliveryDiscountCandidateValue::Percentage(schema::Percentage {
                    value: Decimal(100.0),
                }),
                message: Some("Free shipping".to_string()),
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

    /// The delivery group IDs made free, or an empty list if nothing applied.
    fn free_groups(input: Value) -> Vec<String> {
        let result = run_function_with_input(
            cart_delivery_options_discounts_generate_run,
            &input.to_string(),
        )
        .expect("the function should not error");

        result
            .operations
            .into_iter()
            .flat_map(|operation| match operation {
                schema::DeliveryOperation::DeliveryDiscountsAdd(op) => op.candidates,
                other => panic!("unexpected operation {other:?}"),
            })
            .flat_map(|candidate| {
                assert_eq!(
                    candidate.value,
                    schema::DeliveryDiscountCandidateValue::Percentage(schema::Percentage {
                        value: Decimal(100.0)
                    })
                );
                assert_eq!(candidate.message.as_deref(), Some("Free shipping"));
                candidate.targets
            })
            .map(|target| match target {
                schema::DeliveryDiscountCandidateTarget::DeliveryGroup(group) => group.id,
                other => panic!("unexpected target {other:?}"),
            })
            .collect()
    }

    fn input(config: Value, classes: &[&str], subtotal: &str, groups: &[&str]) -> Value {
        input_with_rate(config, classes, subtotal, groups, "1.0")
    }

    fn input_with_rate(
        config: Value,
        classes: &[&str],
        subtotal: &str,
        groups: &[&str],
        rate: &str,
    ) -> Value {
        let rule_config = if config.is_null() {
            Value::Null
        } else {
            json!({ "jsonValue": config })
        };

        json!({
            "cart": {
                "cost": { "subtotalAmount": { "amount": subtotal } },
                "deliveryGroups": groups.iter().map(|id| json!({ "id": id })).collect::<Vec<_>>()
            },
            "discount": {
                "discountClasses": classes,
                "ruleConfig": rule_config
            },
            "presentmentCurrencyRate": rate
        })
    }

    fn free_shipping_rule() -> Value {
        json!({ "version": 1, "type": "FREE_SHIPPING_THRESHOLD", "minSubtotal": 75 })
    }

    const GROUPS: [&str; 2] = [
        "gid://shopify/CartDeliveryGroup/1",
        "gid://shopify/CartDeliveryGroup/2",
    ];

    #[test]
    fn makes_every_delivery_group_free_at_the_threshold() {
        assert_eq!(
            free_groups(input(free_shipping_rule(), &["SHIPPING"], "75.0", &GROUPS)),
            GROUPS.to_vec()
        );
    }

    #[test]
    fn does_nothing_just_below_the_threshold() {
        assert_eq!(
            free_groups(input(free_shipping_rule(), &["SHIPPING"], "74.99", &GROUPS)),
            Vec::<String>::new()
        );
    }

    #[test]
    fn compares_the_subtotal_in_the_shop_currency() {
        // 100.00 in the buyer's currency at a rate of 1.5 is 66.67 in the shop's.
        assert!(free_groups(input_with_rate(
            free_shipping_rule(),
            &["SHIPPING"],
            "100.0",
            &GROUPS,
            "1.5"
        ))
        .is_empty());

        // 112.50 at 1.5 is exactly 75.00.
        assert_eq!(
            free_groups(input_with_rate(
                free_shipping_rule(),
                &["SHIPPING"],
                "112.5",
                &GROUPS,
                "1.5"
            ))
            .len(),
            2
        );
    }

    #[test]
    fn does_nothing_without_delivery_groups() {
        assert!(free_groups(input(free_shipping_rule(), &["SHIPPING"], "500.0", &[])).is_empty());
    }

    #[test]
    fn needs_the_shipping_discount_class() {
        assert!(free_groups(input(
            free_shipping_rule(),
            &["PRODUCT", "ORDER"],
            "500.0",
            &GROUPS
        ))
        .is_empty());
    }

    #[test]
    fn does_nothing_without_a_config_metafield() {
        assert!(free_groups(input(Value::Null, &["SHIPPING"], "500.0", &GROUPS)).is_empty());
    }

    #[test]
    fn does_nothing_for_a_malformed_config() {
        for config in [
            json!({ "version": 1, "type": "FREE_SHIPPING_THRESHOLD" }),
            json!({ "version": 1, "type": "FREE_SHIPPING_THRESHOLD", "minSubtotal": -5 }),
            json!([1, 2, 3]),
        ] {
            assert!(
                free_groups(input(config.clone(), &["SHIPPING"], "500.0", &GROUPS)).is_empty(),
                "config {config} should apply nothing"
            );
        }
    }

    #[test]
    fn leaves_product_and_order_rules_to_the_cart_lines_target() {
        let subtotal_rule = json!({
            "version": 1,
            "type": "CART_SUBTOTAL_TIERS",
            "tiers": [{ "minSubtotal": 10, "percentage": 10 }]
        });

        assert!(free_groups(input(
            subtotal_rule,
            &["PRODUCT", "ORDER", "SHIPPING"],
            "500.0",
            &GROUPS
        ))
        .is_empty());
    }
}
