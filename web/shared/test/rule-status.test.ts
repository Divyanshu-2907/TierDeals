import { describe, expect, it } from 'vitest';

import { ruleStatus } from '../src/index.js';

const now = new Date('2026-10-14T12:00:00Z');

describe('ruleStatus', () => {
  it('is active between the start and the end', () => {
    expect(
      ruleStatus(
        { active: true, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' },
        now,
      ),
    ).toBe('active');
    expect(ruleStatus({ active: true, startsAt: '2026-10-01T00:00:00Z', endsAt: null }, now)).toBe(
      'active',
    );
  });

  it('is active from the exact start time', () => {
    expect(ruleStatus({ active: true, startsAt: now, endsAt: null }, now)).toBe('active');
  });

  it('is scheduled before the start', () => {
    expect(ruleStatus({ active: true, startsAt: '2026-10-15T00:00:00Z', endsAt: null }, now)).toBe(
      'scheduled',
    );
  });

  it('is expired from the exact end time', () => {
    expect(ruleStatus({ active: true, startsAt: '2026-10-01T00:00:00Z', endsAt: now }, now)).toBe(
      'expired',
    );
  });

  it('is inactive when switched off, whatever the dates', () => {
    expect(ruleStatus({ active: false, startsAt: '2026-10-01T00:00:00Z', endsAt: null }, now)).toBe(
      'inactive',
    );
    expect(ruleStatus({ active: false, startsAt: '2027-01-01T00:00:00Z', endsAt: null }, now)).toBe(
      'inactive',
    );
  });
});
