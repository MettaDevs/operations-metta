import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { minifyContractRouter } from '@orpc/contract';
import * as prettier from 'prettier';
import ts from 'typescript';
import { router } from '../src/main.ts';

// Dua berkas yang diturunkan dari kode dan di-commit, supaya TypeScript mengenal keduanya:
//
// - `src/client.tsx`, entry peramban. Ia merakit route tree TanStack Router dari setiap `.page.tsx` di src/ dan di
//   src/ setiap module, jadi halaman baru cukup ditulis di folder fiturnya tanpa didaftarkan di mana pun. Berkas ini
//   ada di akar src/ karena hanya berkas proses di sana yang boleh meng-import halaman module.
// - `src/platform/shell/api-contract.generated.json`, bentuk route setiap procedure oRPC (method, path, struktur
//   input dan output) yang dibutuhkan OpenAPILink di peramban, tanpa kode server.
// - `src/platform/error-action/record-pages.generated.ts`, kunci setiap `export const record = defineRecordPage(...)`.
//   Server memakainya sebagai tipe kunci halaman di aksi penolakan, jadi kunci yang tidak ada gagal typecheck.
//
// `bun run build` dan `bun run dev` menulis keduanya. `--check` hanya membandingkan, dan CI memakainya.

const root = resolve(import.meta.dir, '..');
export const clientEntry = join(root, 'src', 'client.tsx');
export const contractFile = join(
    root,
    'src',
    'platform',
    'shell',
    'api-contract.generated.json',
);
export const recordPagesFile = join(
    root,
    'src',
    'platform',
    'error-action',
    'record-pages.generated.ts',
);
const layouts = ['app', 'auth'] as const;
type Layout = (typeof layouts)[number];

function isLayout(value: string): value is Layout {
    return layouts.some((layout) => layout === value);
}
export type PageFile = {
    file: string;
    path: string;
    previousPaths: string[];
    layout: Layout;
    validatesSearch: boolean;
    // Kunci `defineRecordPage` bila berkas ini juga meng-export `record`.
    recordKey: string | null;
};

const recordKeyPattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

const posix = (path: string) => path.split(sep).join('/');

export function pageFiles(): string[] {
    return ['src/**/*.page.tsx', 'modules/*/src/**/*.page.tsx']
        .flatMap((pattern) => [
            ...new Bun.Glob(pattern).scanSync({ cwd: root }),
        ])
        .filter((file) => !file.split(/[\\/]/).includes('node_modules'))
        .map((file) => join(root, file))
        .sort((left, right) =>
            posix(relative(root, left)).localeCompare(
                posix(relative(root, right)),
            ),
        );
}

// Bentuk yang dibaca dari setiap halaman: `export const page = definePage({ path: '...', layout: '...', ... })`, dengan
// path, URL lama (`previousPaths`), dan layout sebagai teks literal supaya route tree bisa dirakit tanpa menjalankan
// kode halaman.
export function readPage(file: string): PageFile {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const shown = posix(relative(root, file));
    const recordKey = readRecordKey(source, shown);
    for (const statement of source.statements) {
        if (
            !ts.isVariableStatement(statement) ||
            !statement.modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            )
        )
            continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                !ts.isIdentifier(declaration.name) ||
                declaration.name.text !== 'page'
            )
                continue;
            const call = declaration.initializer;
            const options =
                call && ts.isCallExpression(call) && call.arguments[0];
            if (
                !call ||
                !ts.isCallExpression(call) ||
                call.expression.getText(source) !== 'definePage' ||
                !options ||
                !ts.isObjectLiteralExpression(options)
            )
                throw new Error(
                    `${shown}: \`page\` harus berupa definePage({ ... }).`,
                );
            const property = (name: string) =>
                options.properties.find(
                    (item): item is ts.PropertyAssignment =>
                        ts.isPropertyAssignment(item) &&
                        item.name.getText(source) === name,
                );
            const literal = (name: string) => {
                const value = property(name)?.initializer;
                if (!value || !ts.isStringLiteral(value))
                    throw new Error(
                        `${shown}: \`${name}\` pada definePage harus teks literal.`,
                    );
                return value.text;
            };
            const previous = property('previousPaths')?.initializer;
            if (
                previous &&
                (!ts.isArrayLiteralExpression(previous) ||
                    !previous.elements.every(ts.isStringLiteral))
            )
                throw new Error(
                    `${shown}: \`previousPaths\` pada definePage harus daftar teks literal.`,
                );
            const previousPaths = previous
                ? previous.elements.flatMap((element) =>
                      ts.isStringLiteral(element) ? [element.text] : [],
                  )
                : [];
            const layout = literal('layout');
            if (!isLayout(layout))
                throw new Error(
                    `${shown}: layout harus salah satu dari ${layouts.join(', ')}.`,
                );
            const validatesSearch = options.properties.some(
                (item) =>
                    (ts.isPropertyAssignment(item) ||
                        ts.isShorthandPropertyAssignment(item)) &&
                    item.name.getText(source) === 'validateSearch',
            );
            return {
                file,
                path: literal('path'),
                previousPaths,
                layout,
                validatesSearch,
                recordKey,
            };
        }
    }
    throw new Error(
        `${shown}: berkas .page.tsx wajib meng-export \`page\` dari definePage.`,
    );
}

// `export const record = defineRecordPage({ key: '<app>.<resource>', ... })`, dengan kunci sebagai teks literal.
function readRecordKey(source: ts.SourceFile, shown: string): string | null {
    for (const statement of source.statements) {
        if (
            !ts.isVariableStatement(statement) ||
            !statement.modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            )
        )
            continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                !ts.isIdentifier(declaration.name) ||
                declaration.name.text !== 'record'
            )
                continue;
            const call = declaration.initializer;
            const options =
                call && ts.isCallExpression(call) && call.arguments[0];
            const key =
                options &&
                ts.isObjectLiteralExpression(options) &&
                options.properties.find(
                    (item): item is ts.PropertyAssignment =>
                        ts.isPropertyAssignment(item) &&
                        item.name.getText(source) === 'key',
                )?.initializer;
            if (
                !call ||
                !ts.isCallExpression(call) ||
                call.expression.getText(source) !== 'defineRecordPage' ||
                !key ||
                !ts.isStringLiteral(key)
            )
                throw new Error(
                    `${shown}: \`record\` harus berupa defineRecordPage({ key: '<app>.<resource>', ... }) dengan key teks literal.`,
                );
            if (!recordKeyPattern.test(key.text))
                throw new Error(
                    `${shown}: key record ${key.text} harus berbentuk <app>.<resource>, sama dengan securable halamannya.`,
                );
            return key.text;
        }
    }
    return null;
}

// Nama impor dari path berkas, jadi dua halaman bernama sama di folder berbeda tidak bertabrakan.
function importName(file: string): string {
    const words = posix(relative(root, file))
        .replace(/^src\//, '')
        .replace(/\.page\.tsx$/, '')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    return (
        words
            .map((word, index) =>
                index === 0
                    ? word.toLowerCase()
                    : word.charAt(0).toUpperCase() + word.slice(1),
            )
            .join('') + 'Page'
    );
}

function importPath(file: string): string {
    const path = posix(relative(join(root, 'src'), file));
    return path.startsWith('.') ? path : `./${path}`;
}

export function clientSource(pages: PageFile[]): string {
    // Path halaman dan URL lamanya berbagi satu ruang alamat: URL lama tidak boleh menunjuk dua halaman, dan tidak
    // boleh menutupi halaman yang sekarang ada.
    const seen = new Map<string, string>();
    for (const page of pages)
        for (const path of [page.path, ...page.previousPaths]) {
            const other = seen.get(path);
            if (other)
                throw new Error(
                    `Dua halaman memakai path ${path}: ${other} dan ${posix(relative(root, page.file))}.`,
                );
            seen.set(path, posix(relative(root, page.file)));
        }
    const records = recordPages(pages);
    const parents = { app: 'appLayoutRoute', auth: 'authLayoutRoute' };
    // Setiap route satu konstanta sendiri. createRoute yang ditulis langsung di dalam addChildren([...]) kehilangan
    // tipenya di TypeScript, dan route tree yang tidak bertipe tidak memeriksa path maupun search params.
    const route = (page: PageFile) => {
        const name = importName(page.file);
        const options = [
            `getParentRoute: () => ${parents[page.layout]}`,
            `path: ${name}.path`,
            `component: ${name}.component`,
            ...(page.validatesSearch
                ? [`validateSearch: ${name}.validateSearch`]
                : []),
            `staticData: { title: ${name}.title }`,
        ];
        return `const ${name.replace(/Page$/, 'Route')} = createRoute({ ${options.join(', ')} });`;
    };
    // URL lama dialihkan ke path halamannya, satu route per URL lama, langsung di bawah root supaya tidak menunggu
    // data Shell lebih dulu.
    const previous = pages.flatMap((page) =>
        page.previousPaths.map(
            (path) =>
                `previousPathRoute('${path}', ${importName(page.file)}.path)`,
        ),
    );
    const children = (layout: Layout) =>
        pages
            .filter((page) => page.layout === layout)
            .map((page) => importName(page.file).replace(/Page$/, 'Route'))
            .join(', ');
    return `// Dibuat \`bun scripts/generate-client.ts\` dari setiap berkas \`.page.tsx\`; jangan disunting tangan. \`bun run build\`
// dan \`bun run dev\` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
${pages.map((page) => `import { page as ${importName(page.file)}${page.recordKey ? `, record as ${recordName(page.file)}` : ''} } from '${importPath(page.file)}';`).join('\n')}
import {
    appLayoutRoute,
    authLayoutRoute,
    previousPathRoute,
    rootRoute,
    routerOptions,
    startClient,
    type RecordPages,
} from './platform/shell/index.ts';

${pages.map(route).join('\n\n')}

const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([${children('app')}]),
    authLayoutRoute.addChildren([${children('auth')}]),
    ${previous.join(', ')}
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

const recordPages = {
    ${records.map((page) => `'${page.recordKey}': ${recordName(page.file)}`).join(',\n    ')}
} satisfies RecordPages;

startClient(router, recordPages);
`;
}

// Halaman yang meng-export record, urut kuncinya. Satu kunci hanya boleh dimiliki satu halaman.
function recordPages(pages: PageFile[]): PageFile[] {
    const owners = new Map<string, PageFile>();
    for (const page of pages) {
        if (!page.recordKey) continue;
        const other = owners.get(page.recordKey);
        if (other)
            throw new Error(
                `Dua halaman memakai key record ${page.recordKey}: ${posix(relative(root, other.file))} dan ${posix(relative(root, page.file))}.`,
            );
        owners.set(page.recordKey, page);
    }
    return [...owners.values()].sort((left, right) =>
        (left.recordKey ?? '').localeCompare(right.recordKey ?? ''),
    );
}

function recordName(file: string): string {
    return importName(file).replace(/Page$/, 'Record');
}

export function recordPagesSource(pages: PageFile[]): string {
    const keys = recordPages(pages).map((page) => `'${page.recordKey}'`);
    return `// Dibuat \`bun scripts/generate-client.ts\` dari setiap \`defineRecordPage\` di berkas \`.page.tsx\`; jangan disunting tangan.
export const recordPageKeys = [${keys.join(', ')}] as const;
`;
}

async function format(source: string, file: string): Promise<string> {
    const options = await prettier.resolveConfig(file);
    return prettier.format(source, { ...options, filepath: file });
}

export async function generatedFiles(): Promise<Map<string, string>> {
    const pages = pageFiles().map(readPage);
    return new Map([
        [clientEntry, await format(clientSource(pages), clientEntry)],
        [
            recordPagesFile,
            await format(recordPagesSource(pages), recordPagesFile),
        ],
        [
            contractFile,
            await format(
                JSON.stringify(minifyContractRouter(router)),
                contractFile,
            ),
        ],
    ]);
}

// Berkas yang isinya berbeda dari hasil generate. Kosong berarti mutakhir.
export async function staleFiles(): Promise<string[]> {
    const stale: string[] = [];
    for (const [file, content] of await generatedFiles()) {
        const current = Bun.file(file);
        if (!(await current.exists()) || (await current.text()) !== content)
            stale.push(posix(relative(root, file)));
    }
    return stale;
}

export async function writeGeneratedFiles(): Promise<void> {
    for (const [file, content] of await generatedFiles()) {
        const current = Bun.file(file);
        if (!(await current.exists()) || (await current.text()) !== content)
            await Bun.write(file, content);
    }
}

if (import.meta.main) {
    if (process.argv.includes('--check')) {
        const stale = await staleFiles();
        if (stale.length) {
            console.error(
                `Berkas hasil generate tidak mutakhir: ${stale.join(', ')}. Jalankan \`bun scripts/generate-client.ts\` lalu commit hasilnya.`,
            );
            process.exit(1);
        }
        console.log('Berkas hasil generate mutakhir.');
    } else {
        await writeGeneratedFiles();
        console.log(
            'src/client.tsx, kontrak API, dan kunci halaman record ditulis ulang.',
        );
    }
}
