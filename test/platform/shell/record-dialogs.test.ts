import { test } from 'bun:test';
import { join } from 'node:path';

// Skenario DOM berjalan di proses Bun sendiri dengan DOM jsdom dari packages/ui, seperti skenario komponen di sana.
test('an error action opens its record over the refused form, keeps the input, and never submits that form', () => {
    const result = Bun.spawnSync({
        cmd: [
            process.execPath,
            '--preload',
            join(import.meta.dir, '../../../packages/ui/test/support/dom.ts'),
            join(import.meta.dir, '../../support/record-dialogs.scenario.ts'),
        ],
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0)
        throw new Error(
            `${result.stdout.toString()}${result.stderr.toString()}`,
        );
}, 30_000);
