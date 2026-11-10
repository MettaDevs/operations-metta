import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

type Audience = 'user' | 'internal' | 'integration';

const root = resolve(import.meta.dir, '..');
const core = join(root, 'src');
const modules = join(root, 'modules') + sep;
const packages = join(root, 'packages') + sep;

function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.name === 'node_modules') return [];
        if (entry.isDirectory()) return files(path);
        return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
    });
}

function target(file: string, specifier: string): string | null {
    if (specifier.startsWith('@core/')) return join(core, specifier.slice(6));
    if (specifier.startsWith('.')) return resolve(dirname(file), specifier);
    return null;
}

function moduleOf(path: string): string | null {
    return path.startsWith(modules)
        ? (relative(modules, path).split(sep)[0] ?? null)
        : null;
}

function packageOf(path: string): string | null {
    return path.startsWith(packages)
        ? (relative(packages, path).split(sep)[0] ?? null)
        : null;
}

// `@operations-metta/<nama>` juga nama package di packages/, jadi hanya nama yang punya folder di modules/
// yang dihitung module.
function importedModule(file: string, specifier: string): string | null {
    if (specifier.startsWith('@operations-metta/')) {
        const name = specifier.split('/')[1];
        return name && existsSync(join(modules, name)) ? name : null;
    }
    const path = target(file, specifier);
    return path === null ? null : moduleOf(path);
}

// Nama fitur dibuang lebih dulu, jadi fitur bernama `internal` tetap dibaca dari perannya.
function audienceOf(path: string): Audience | null {
    const roles = basename(path)
        .replace(/\.(ts|tsx|js|mjs|cjs)$/, '')
        .split('.')
        .slice(1);
    if (roles.includes('internal')) return 'internal';
    if (roles.includes('integration')) return 'integration';
    return roles.at(-1) === 'routes' ? 'user' : null;
}

// Impor ke folder kemampuan itu sendiri diselesaikan ke index.ts-nya, jadi hanya path di dalam folder yang dihitung.
function capabilityOf(path: string): string | null {
    const [layer, capability, ...rest] = relative(core, path).split(sep);
    if (layer !== 'platform' && layer !== 'foundation') return null;
    return capability && rest.length
        ? join(core, layer, capability) + sep
        : null;
}

const shown = (path: string) => relative(root, path).replaceAll(sep, '/');

// Test hanya ada di test/ (untuk src/ dan scripts/), di test/ module (untuk src/ module), atau di test/ package (untuk
// src/ package), di folder yang sama dengan folder kode yang diujinya. Bantuan test ada di support/ folder test itu.
// Kode tidak meng-import folder test.
const scripts = join(root, 'scripts');
const coreTests = join(root, 'test');
const isTest = (path: string) => /\.test\.(ts|tsx)$/.test(path);
function testRootOf(path: string): string | null {
    if (path.startsWith(coreTests + sep)) return coreTests;
    const module = moduleOf(path);
    const owned = packageOf(path);
    const owner =
        module !== null
            ? join(modules, module)
            : owned !== null
              ? join(packages, owned)
              : null;
    if (owner === null) return null;
    const tests = join(owner, 'test');
    return path.startsWith(tests + sep) ? tests : null;
}
function mirroredFolder(file: string, tests: string): string | null {
    const folder = relative(tests, dirname(file));
    const [first, ...rest] = folder.split(sep);
    if (first === 'support') return null;
    if (tests !== coreTests) return join(dirname(tests), 'src', folder);
    return first === 'scripts' ? join(scripts, ...rest) : join(core, folder);
}

const violations: string[] = [];
const testFiles = [
    ...files(coreTests),
    ...files(modules),
    ...files(packages),
].filter((file) => testRootOf(file) !== null);
for (const file of testFiles) {
    const tests = testRootOf(file);
    if (tests === null) continue;
    const mirrored = isTest(file) ? mirroredFolder(file, tests) : null;
    if (mirrored !== null && !existsSync(mirrored))
        violations.push(
            `${shown(file)}; ${shown(dirname(file))} mirrors no folder of the code it tests. Move the test next to the mirror of that code.`,
        );
}
const checked = [...files(core), ...files(modules)].filter(
    (file) => testRootOf(file) === null,
);
const packageCode = files(packages).filter((file) => testRootOf(file) === null);
for (const file of [...checked, ...packageCode, ...files(scripts)]) {
    if (isTest(file))
        violations.push(
            `${shown(file)}; tests live under test/, the module's test/, or the package's test/, in the folder that mirrors the code they test.`,
        );
    const text = readFileSync(file, 'utf8');
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        const path = target(file, imported.fileName);
        if (path !== null && testRootOf(path) !== null)
            violations.push(
                `${shown(file)} imports ${shown(path)}; code must not import a test folder.`,
            );
    }
}
for (const file of checked) {
    const text = readFileSync(file, 'utf8');
    const name = shown(file);
    const inCore = file.startsWith(core + sep);
    const isProcess = dirname(file) === core;
    const ownModule = moduleOf(file);
    const ownAudience = audienceOf(file);
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        const specifier = imported.fileName;
        const found = `${name}:${lineOf(imported.pos)} imports ${specifier}`;
        const otherModule = importedModule(file, specifier);
        if (inCore && !isProcess && otherModule !== null)
            violations.push(
                `${found}; only process files at the root of src/ may import from modules/.`,
            );
        if (
            ownModule !== null &&
            otherModule !== null &&
            otherModule !== ownModule
        )
            violations.push(
                `${found}; modules/${ownModule}/ must not import another module.`,
            );
        const path = target(file, specifier);
        if (path === null) continue;
        const capability = capabilityOf(path);
        // Entry peramban di akar src/ merakit route tree dari setiap halaman, jadi ia meng-import `.page.tsx`
        // langsung. Itu satu-satunya jalan masuk ke sebuah folder kemampuan selain index.ts.
        const routedPage = isProcess && path.endsWith('.page.tsx');
        if (
            capability &&
            !file.startsWith(capability) &&
            path !== join(capability, 'index.ts') &&
            !routedPage
        )
            violations.push(
                `${found}; outside ${shown(capability)}/ import only ${shown(capability)}/index.ts.`,
            );
        if (
            !inCore &&
            path.startsWith(core + sep) &&
            !specifier.startsWith('@core/')
        )
            violations.push(
                `${found}; modules import Core only through @core/.`,
            );
        const targetAudience = audienceOf(path);
        if (
            ownAudience !== null &&
            targetAudience !== null &&
            targetAudience !== ownAudience
        )
            violations.push(
                `${found}; ${ownAudience} files must not import ${targetAudience} files.`,
            );
    }
    // Awalan tabel setiap module: aset_ milik asset-management, kes_ milik healthcare.
    if (inCore)
        for (const match of text.matchAll(/aset_|(?<![a-z])kes_/g))
            violations.push(
                `${name}:${lineOf(match.index)} contains "${match[0]}"; module tables belong under modules/.`,
            );
}

// Package adalah pustaka yang dipakai Core dan module, jadi ia tidak bergantung pada keduanya.
for (const file of files(packages)) {
    const text = readFileSync(file, 'utf8');
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        const specifier = imported.fileName;
        const path = target(file, specifier);
        if (
            importedModule(file, specifier) !== null ||
            path?.startsWith(core + sep)
        )
            violations.push(
                `${shown(file)}:${lineOf(imported.pos)} imports ${specifier}; packages/ must not import Core or a module.`,
            );
    }
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`${violations.length} boundary violation(s).`);
    process.exit(1);
}
console.log(
    `Boundaries hold across ${checked.length} files under src/ and modules/, ${packageCode.length} under packages/, and ${testFiles.length} test files.`,
);
