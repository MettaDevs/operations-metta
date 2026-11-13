import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('Tambah banyak adds one document line per chosen record and keeps the card open', () => {
    runScenario('select-records');
}, 30_000);
