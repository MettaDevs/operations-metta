import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('FactBox without attachments shows only details in jsdom', () => {
    runScenario('fact-box');
}, 30_000);
