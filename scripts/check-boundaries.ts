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

const violations: string[] = [];
const checked = files(core);
for (const file of checked) {
    const text = readFileSync(file, 'utf8');
    const name = relative(root, file).replaceAll(sep, '/');
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    if (file !== compositionRoot)
        for (const imported of ts.preProcessFile(text, true, true)
            .importedFiles)
            if (importsModule(file, imported.fileName))
                violations.push(
                    `${name}:${lineOf(imported.pos)} imports ${imported.fileName}; only src/main.ts may import from modules/.`,
                );
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
console.log(`Boundaries hold across ${checked.length} files under src/.`);
