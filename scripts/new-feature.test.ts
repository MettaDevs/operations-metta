import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const script = join(import.meta.dir, 'new-feature.ts');
const moduleIndex = 'modules/asset-management/src/index.ts';
const featureDirectory =
    'modules/asset-management/src/fixed-asset/asset-disposal';
let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'new-feature-'));
    mkdirSync(join(root, 'modules/asset-management/src'), { recursive: true });
    copyFileSync(
        join(import.meta.dir, '..', moduleIndex),
        join(root, moduleIndex),
    );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function newFeature(...args: string[]) {
    return Bun.spawnSync([process.execPath, script, ...args], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
    });
}

function registrations() {
    const text = readFileSync(join(root, moduleIndex), 'utf8');
    return {
        imports: ts
            .preProcessFile(text, true, true)
            .importedFiles.map((file) => file.fileName),
        spreads: [...text.matchAll(/\.\.\.(\w+)\(\)/g)].map(
            (match) => match[1],
        ),
    };
}

test('creates the feature files in one folder and registers its routes in the module', () => {
    const before = registrations();
    const result = newFeature('asset-management/fixed-asset/asset-disposal');

    expect(result.exitCode).toBe(0);
    expect(readdirSync(join(root, featureDirectory)).sort()).toEqual([
        'asset-disposal.routes.ts',
        'asset-disposal.schema.ts',
        'asset-disposal.service.ts',
        'asset-disposal.test.ts',
    ]);
    expect(
        readFileSync(
            join(root, featureDirectory, 'asset-disposal.routes.ts'),
            'utf8',
        ),
    ).toContain('export function assetDisposalRoutes(');
    expect(registrations()).toEqual({
        imports: [
            ...before.imports,
            './fixed-asset/asset-disposal/asset-disposal.routes.ts',
        ],
        spreads: [...before.spreads, 'assetDisposalRoutes'],
    });
}, 30_000);

test.each([
    ['internal', 'InternalRoutes'],
    ['integration', 'IntegrationRoutes'],
])(
    '--audience %s names the routes file and its registration after the caller',
    (audience, exportSuffix) => {
        const before = registrations();
        const result = newFeature(
            'asset-management/fixed-asset/asset-disposal',
            '--audience',
            audience,
        );
        const routesFile = `asset-disposal.${audience}.routes.ts`;

        expect(result.exitCode).toBe(0);
        expect(readdirSync(join(root, featureDirectory)).sort()).toEqual([
            routesFile,
            'asset-disposal.schema.ts',
            'asset-disposal.service.ts',
            'asset-disposal.test.ts',
        ]);
        expect(registrations()).toEqual({
            imports: [
                ...before.imports,
                `./fixed-asset/asset-disposal/${routesFile}`,
            ],
            spreads: [...before.spreads, `assetDisposal${exportSuffix}`],
        });
    },
    30_000,
);

test('refuses to overwrite an existing feature and writes nothing', () => {
    expect(
        newFeature('asset-management/fixed-asset/asset-disposal').exitCode,
    ).toBe(0);
    const schema = join(root, featureDirectory, 'asset-disposal.schema.ts');
    const routes = join(root, featureDirectory, 'asset-disposal.routes.ts');
    writeFileSync(schema, 'edited by hand');
    rmSync(routes);
    const index = readFileSync(join(root, moduleIndex), 'utf8');

    const result = newFeature('asset-management/fixed-asset/asset-disposal');

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('asset-disposal.schema.ts');
    expect(readFileSync(schema, 'utf8')).toBe('edited by hand');
    expect(existsSync(routes)).toBe(false);
    expect(readFileSync(join(root, moduleIndex), 'utf8')).toBe(index);
}, 30_000);

test('refuses a module folder that does not exist', () => {
    const result = newFeature('patient-care/visit/visit-intake');

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('modules/patient-care/');
    expect(existsSync(join(root, 'modules/patient-care'))).toBe(false);
});
