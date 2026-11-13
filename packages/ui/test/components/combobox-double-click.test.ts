import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('double-clicking an option does not open the control under the closed list', () => {
    runScenario('combobox-double-click');
}, 30_000);
