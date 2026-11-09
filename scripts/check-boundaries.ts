import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const core = join(root, 'src');
const modules = join(root, 'modules') + sep;
const compositionRoot = join(core, 'main.ts');

function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path);
        return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
    });
}

function importsModule(file: string, specifier: string): boolean {
    if (specifier.startsWith('@operations-metta/')) return true;
    if (!specifier.startsWith('.')) return false;
    return resolve(dirname(file), specifier).startsWith(modules);
}

function target(file: string, specifier: string): string | null {
    if (specifier.startsWith('@core/')) return join(core, specifier.slice(6));
    if (specifier.startsWith('.')) return resolve(dirname(file), specifier);
    return null;
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

const violations: string[] = [];
const checked = [...files(core), ...files(modules)];
for (const file of checked) {
    const text = readFileSync(file, 'utf8');
    const name = shown(file);
    const inCore = file.startsWith(core + sep);
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
        const specifier = imported.fileName;
        const found = `${name}:${lineOf(imported.pos)} imports ${specifier}`;
        if (
            inCore &&
            file !== compositionRoot &&
            importsModule(file, specifier)
        )
            violations.push(
                `${found}; only src/main.ts may import from modules/.`,
            );
        const path = target(file, specifier);
        if (path === null) continue;
        const capability = capabilityOf(path);
        if (
            capability &&
            !file.startsWith(capability) &&
            path !== join(capability, 'index.ts')
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
    }
    if (inCore)
        for (const match of text.matchAll(/aset_/g))
            violations.push(
                `${name}:${lineOf(match.index)} contains "aset_"; module tables belong under modules/.`,
            );
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`${violations.length} boundary violation(s).`);
    process.exit(1);
}
console.log(
    `Boundaries hold across ${checked.length} files under src/ and modules/.`,
);
