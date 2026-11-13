import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('a card with unsaved changes asks before Escape or close discards them, whoever opened it', () => {
    runScenario('page-dialog-unsaved');
}, 30_000);
