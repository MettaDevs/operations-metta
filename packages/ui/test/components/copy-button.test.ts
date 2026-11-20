import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('copies text, shows Disalin briefly, and reports a refused clipboard', () => {
    runScenario('copy-button');
}, 30_000);
