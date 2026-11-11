import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    clientEntry,
    clientSource,
    pageFiles,
    readPage,
    staleFiles,
} from '../../scripts/generate-client.ts';

const scratch = await mkdtemp(join(tmpdir(), 'ops-pages-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

test('the committed client entry and API contract match what the generator writes', async () => {
    expect(await staleFiles()).toEqual([]);
});

test('the route tree imports every page, and each import resolves', async () => {
    const pages = pageFiles();
    expect(pages.length).toBeGreaterThan(0);
    const source = await Bun.file(clientEntry).text();
    const imported = [...source.matchAll(/from '(\.[^']+\.page\.tsx)'/g)].map(
        (match) => Bun.resolveSync(match[1]!, dirname(clientEntry)),
    );
    expect(imported.sort()).toEqual([...pages].sort());
    for (const page of pages.map(readPage))
        expect(page.path).toMatch(/^\/[a-z0-9/-]*$/);
});

test('a page must declare its path and layout as literals through definePage', async () => {
    const file = join(scratch, 'broken.page.tsx');
    await Bun.write(file, "export const page = { path: '/x' };\n");
    expect(() => readPage(file)).toThrow('definePage');
    await Bun.write(
        file,
        "const where = '/x';\nexport const page = definePage({ path: where, layout: 'app', title: 'X', component: X });\n",
    );
    expect(() => readPage(file)).toThrow(
        '`path` pada definePage harus teks literal',
    );
    await Bun.write(
        file,
        "export const page = definePage({ path: '/x', layout: 'modal', title: 'X', component: X });\n",
    );
    expect(() => readPage(file)).toThrow('layout harus salah satu dari');
    await Bun.write(
        file,
        "export const page = definePage({ path: '/x', layout: 'app', title: 'X', validateSearch, component: X });\n",
    );
    expect(readPage(file)).toEqual({
        file,
        path: '/x',
        previousPaths: [],
        layout: 'app',
        validatesSearch: true,
    });
    await Bun.write(
        file,
        "const old = '/y';\nexport const page = definePage({ path: '/x', previousPaths: [old], layout: 'app', title: 'X', component: X });\n",
    );
    expect(() => readPage(file)).toThrow(
        '`previousPaths` pada definePage harus daftar teks literal',
    );
    await Bun.write(
        file,
        "export const page = definePage({ path: '/x', previousPaths: ['/y', '/z'], layout: 'app', title: 'X', component: X });\n",
    );
    expect(readPage(file).previousPaths).toEqual(['/y', '/z']);
});

// URL layar sebelum rail dibagi per area (11 November 2026). Bookmark dan tautan lama tetap membuka halaman yang sama.
const movedScreens: [string, string][] = [
    ['/dashboard', '/'],
    ['/settings/legal-entities', '/sysadmin/organization/legal-entities'],
    ['/settings/operating-units', '/sysadmin/organization/operating-units'],
    [
        '/settings/organization-hierarchies',
        '/sysadmin/organization/hierarchies',
    ],
    ['/settings/global-address-book', '/sysadmin/address-book/parties'],
    ['/settings/occupations', '/sysadmin/address-book/occupations'],
    [
        '/settings/party-duplicate-check',
        '/sysadmin/address-book/duplicate-check',
    ],
    ['/settings/access', '/sysadmin/access/staff'],
    ['/settings/roles', '/sysadmin/access/roles'],
    [
        '/settings/security-configuration',
        '/sysadmin/access/security-configuration',
    ],
    ['/settings/address-setup', '/sysadmin/geography/address-setup'],
    ['/settings/number-sequences', '/sysadmin/number-sequences'],
    ['/healthcare/patients', '/healthcare/patient/patients'],
    ['/healthcare/sharing-policies', '/healthcare/patient/sharing-policies'],
    ['/healthcare/patient-types', '/healthcare/coverage/patient-types'],
    ['/healthcare/guarantors', '/healthcare/coverage/guarantors'],
];

test('every old screen URL redirects to the page that moved, and the route tree carries the redirect', async () => {
    const pages = pageFiles().map(readPage);
    const redirects = new Map(
        pages.flatMap((page) =>
            page.previousPaths.map((from) => [from, page.path] as const),
        ),
    );
    expect([...redirects].sort()).toEqual([...movedScreens].sort());
    // Tidak ada URL lama yang menutupi halaman yang sekarang ada.
    const current = new Set(pages.map((page) => page.path));
    for (const from of redirects.keys()) expect(current.has(from)).toBe(false);
    const source = await Bun.file(clientEntry).text();
    for (const [from] of movedScreens)
        expect(source).toMatch(
            new RegExp(`previousPathRoute\\(\\s*'${from}',`),
        );
});

test('two pages may not claim the same old URL', async () => {
    const first = join(scratch, 'first.page.tsx');
    const second = join(scratch, 'second.page.tsx');
    await Bun.write(
        first,
        "export const page = definePage({ path: '/a', previousPaths: ['/old'], layout: 'app', title: 'A', component: A });\n",
    );
    await Bun.write(
        second,
        "export const page = definePage({ path: '/b', previousPaths: ['/old'], layout: 'app', title: 'B', component: B });\n",
    );
    expect(() => clientSource([readPage(first), readPage(second)])).toThrow(
        'Dua halaman memakai path /old',
    );
});
