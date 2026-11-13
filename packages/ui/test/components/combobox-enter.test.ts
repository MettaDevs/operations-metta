import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('Enter in a lookup or Select search picks or does nothing, never submits the form', () => {
    runScenario('combobox-enter');
}, 30_000);
