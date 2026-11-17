import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('sections close independently and preserve mounted drafts', () => {
    runScenario('collapsible-section');
}, 30_000);
