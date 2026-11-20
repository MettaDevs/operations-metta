import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('two clicks pick a range, presets set from and to, a reversed range shows an error', () => {
    runScenario('date-range-picker');
}, 30_000);
