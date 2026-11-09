import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import * as prettier from 'prettier';
import ts from 'typescript';

type Audience = 'user' | 'internal' | 'integration';
type Feature = {
    module: string;
    area: string;
    feature: string;
    audience: Audience;
};
type Names = { kebab: string; camel: string; pascal: string };

const routeFiles = {
    user: { suffix: 'routes', exportSuffix: 'Routes' },
    internal: { suffix: 'internal.routes', exportSuffix: 'InternalRoutes' },
    integration: {
        suffix: 'integration.routes',
        exportSuffix: 'IntegrationRoutes',
    },
} satisfies Record<Audience, { suffix: string; exportSuffix: string }>;

const usage =
    'Pakai: bun run new-feature <module>/<area>/<fitur> [--audience internal|integration]';

function isAudience(value: string): value is Audience {
    return Object.hasOwn(routeFiles, value);
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function parse(argv: string[]): Feature {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { audience: { type: 'string', default: 'user' } },
        allowPositionals: true,
    });
    const audience = values.audience;
    if (!isAudience(audience))
        fail(`Audience "${audience}" tidak dikenal.\n${usage}`);
    const segments = positionals.length === 1 ? positionals[0]!.split('/') : [];
    const [module, area, feature] = segments;
    if (segments.length !== 3 || !module || !area || !feature) fail(usage);
    for (const segment of segments)
        if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(segment))
            fail(`"${segment}" harus kebab-case, misalnya asset-receipt.`);
    return { module, area, feature, audience };
}

function names(kebab: string): Names {
    const words = kebab.split('-');
    const capital = (word: string) => word[0]!.toUpperCase() + word.slice(1);
    return {
        kebab,
        camel: words[0] + words.slice(1).map(capital).join(''),
        pascal: words.map(capital).join(''),
    };
}

const schema = ({ camel, pascal }: Names) => `import { z } from 'zod';

export const ${camel}Schema = z.object({
    id: z.string(),
});
export type ${pascal}View = z.infer<typeof ${camel}Schema>;
`;

const service = ({ kebab, pascal }: Names) =>
    `import type { Workspace } from '@core/platform/access/index.ts';
import type { Database } from '@core/platform/database/index.ts';
import type { ${pascal}View } from './${kebab}.schema.ts';

export class ${pascal}Service {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(): Promise<${pascal}View[]> {
        return [];
    }
}
`;

const test = ({ kebab }: Names) => `import { test } from 'bun:test';

test.todo('${kebab}');
`;

function routes(audience: Audience, name: Names, exportName: string): string {
    switch (audience) {
        case 'user':
            return `import { base, ok, type Context } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import { ${name.pascal}Service } from './${name.kebab}.service.ts';

export function ${exportName}() {
    async function domain(context: Context) {
        return new ${name.pascal}Service(context.db, await moduleWorkspace(context));
    }
    const path: \`/\${string}\` = \`/api/modules/\${moduleId}/v1/${name.kebab}\`;
    return {
        ${name.camel}List: base
            .route({ method: 'GET', path, outputStructure: 'detailed' })
            .handler(async ({ context }) =>
                ok({ data: await (await domain(context)).list() }),
            ),
    };
}
`;
        case 'internal':
        case 'integration': {
            const caller =
                audience === 'internal' ? 'control plane' : 'sistem luar';
            return `// Core belum punya autentikasi untuk panggilan dari ${caller}, jadi route ditambahkan sesudah pintunya ada di src/platform/.
export function ${exportName}() {
    return {};
}
`;
        }
        default: {
            const unknown: never = audience;
            throw new Error(`Audience tidak dikenal: ${unknown}`);
        }
    }
}

function register(index: string, exportName: string, from: string): string {
    const source = ts.createSourceFile(
        'index.ts',
        index,
        ts.ScriptTarget.Latest,
        true,
    );
    const objects: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node) => {
        if (
            ts.isReturnStatement(node) &&
            node.expression &&
            ts.isObjectLiteralExpression(node.expression) &&
            node.expression.properties.every(
                (property) =>
                    ts.isSpreadAssignment(property) &&
                    ts.isCallExpression(property.expression),
            )
        )
            objects.push(node.expression);
        ts.forEachChild(node, visit);
    };
    visit(source);
    const object = objects.length === 1 ? objects[0]! : null;
    if (object === null)
        fail(
            'index.ts module harus punya tepat satu `return { ...xRoutes() }`. Daftarkan route-nya dengan tangan.',
        );
    const last = object.properties.at(-1);
    const spreadAt = last ? last.end : object.getStart(source) + 1;
    const spread = last ? `, ...${exportName}()` : `...${exportName}()`;
    const importAt =
        source.statements.filter(ts.isImportDeclaration).at(-1)?.end ?? 0;
    const line = `import { ${exportName} } from '${from}';`;
    return (
        index.slice(0, importAt) +
        (importAt ? `\n${line}` : `${line}\n`) +
        index.slice(importAt, spreadAt) +
        spread +
        index.slice(spreadAt)
    );
}

async function formatted(path: string, text: string): Promise<string> {
    const config = await prettier.resolveConfig(path);
    return prettier.format(text, { ...config, filepath: path });
}

const request = parse(Bun.argv.slice(2));
const root = process.cwd();
const shown = (path: string) => relative(root, path).replaceAll(sep, '/');
const moduleDirectory = join(root, 'modules', request.module);
const index = join(moduleDirectory, 'src', 'index.ts');
if (!existsSync(moduleDirectory))
    fail(`modules/${request.module}/ tidak ada. Buat module-nya lebih dulu.`);
if (!existsSync(index))
    fail(`modules/${request.module}/src/index.ts tidak ada.`);

const name = names(request.feature);
const route = routeFiles[request.audience];
const exportName = name.camel + route.exportSuffix;
const directory = join(moduleDirectory, 'src', request.area, request.feature);
const routesFile = `${name.kebab}.${route.suffix}.ts`;
// Test fitur ada di test/ module, di folder yang sama dengan folder fiturnya di src/.
const testDirectory = join(
    moduleDirectory,
    'test',
    request.area,
    request.feature,
);
const created = [
    { path: join(directory, `${name.kebab}.schema.ts`), text: schema(name) },
    { path: join(directory, `${name.kebab}.service.ts`), text: service(name) },
    {
        path: join(directory, routesFile),
        text: routes(request.audience, name, exportName),
    },
    { path: join(testDirectory, `${name.kebab}.test.ts`), text: test(name) },
];
const existing = created.filter(({ path }) => existsSync(path));
if (existing.length)
    fail(
        `Berkas sudah ada, tidak ada yang ditulis:\n${existing.map(({ path }) => `  ${shown(path)}`).join('\n')}`,
    );
const registered = register(
    readFileSync(index, 'utf8'),
    exportName,
    `./${request.area}/${request.feature}/${routesFile}`,
);

const outputs = [...created, { path: index, text: registered }];
const written = await Promise.all(
    outputs.map(async ({ path, text }) => ({
        path,
        text: await formatted(path, text),
    })),
);
for (const { path, text } of written) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
}
console.log(
    `Fitur ${request.module}/${request.area}/${request.feature} dibuat:\n${written.map(({ path }) => `  ${shown(path)}`).join('\n')}`,
);
