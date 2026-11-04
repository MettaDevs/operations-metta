import { expect, test } from 'bun:test';
import { depreciationStart } from '../src/inventory.ts';

test('book snapshots use placed-in-service date with the configured convention', () => {
    expect(depreciationStart('2026-11-03', 'full_month')).toBe('2026-11-01');
    expect(depreciationStart('2026-12-16', 'mid_month_1st')).toBe('2027-01-01');
    expect(depreciationStart('2026-11-03', 'none')).toBe('2026-11-03');
});
