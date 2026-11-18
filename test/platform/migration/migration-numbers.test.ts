import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';

describe('migration numbers', () => {
    test('every owner in this repo numbers its migrations uniquely', () => {
        expect(() =>
            readMigrationSource(resolve(import.meta.dir, '../../..')),
        ).not.toThrow();
    });

    test('two migrations with the same number are refused', () => {
        const root = mkdtempSync(join(tmpdir(), 'migration-numbers-'));
        const core = join(root, 'database', 'migrations');
        mkdirSync(core, { recursive: true });
        mkdirSync(join(root, 'modules'));
        writeFileSync(join(core, '0001_first.sql'), 'select 1;');
        writeFileSync(join(core, '0002_bank.sql'), 'select 1;');
        writeFileSync(join(core, '0002_dates.sql'), 'select 1;');

        expect(() => readMigrationSource(root)).toThrow(
            'core has two migrations numbered 0002: 0002_bank.sql and 0002_dates.sql',
        );
    });
});
