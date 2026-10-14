import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { evaluateRule, parseFunctionRule, type CartFacts } from '../src/evaluator.js';

/**
 * Runs every case in /fixtures/rules through the TypeScript evaluator. The
 * Rust Function runs the same files in cargo test (src/parity_tests.rs); a
 * case that passes in one and not the other means the two have drifted.
 */
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/rules', import.meta.url));

/** Same tolerance both evaluators use for threshold comparisons. */
const TOLERANCE = 1e-6;

interface Fixture {
  description: string;
  config: unknown;
  cart: CartFacts;
  expected: Record<string, unknown>;
}

function fixtureFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .flatMap((path) =>
      statSync(path).isDirectory() ? fixtureFiles(path) : path.endsWith('.json') ? [path] : [],
    )
    .sort();
}

function decisionFor(fixture: Fixture): Record<string, unknown> {
  const parsed = parseFunctionRule(fixture.config);
  if (!parsed.ok) return { decision: 'invalid_config' };
  return { ...evaluateRule(parsed.rule, fixture.cart) };
}

/** Rounds numbers to the tolerance so toEqual compares them approximately. */
function approximately(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value / TOLERANCE) * TOLERANCE;
  if (Array.isArray(value)) return value.map(approximately);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, approximately(v)]));
  }
  return value;
}

const files = fixtureFiles(FIXTURES_DIR);

describe('shared rule fixtures (parity with the Rust Function)', () => {
  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it.each(files.map((file) => [relative(FIXTURES_DIR, file), file]))('%s', (_name, file) => {
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;

    expect(approximately(decisionFor(fixture))).toEqual(approximately(fixture.expected));
  });
});
