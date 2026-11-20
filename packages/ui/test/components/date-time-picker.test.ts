import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('picking a day keeps the time, typed and preset times commit, an invalid time shows an error', () => {
    runScenario('date-time-picker');
}, 30_000);
