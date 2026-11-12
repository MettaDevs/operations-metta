import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('InlineLookup magnifier opens Daftar lengkap and Pilih sets the field', () => {
    runScenario('inline-lookup-full-list');
}, 30_000);
