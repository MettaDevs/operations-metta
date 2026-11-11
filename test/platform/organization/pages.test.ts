import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readPage } from '../../../scripts/generate-client.ts';
import { sysAdminArea } from '../../../src/platform/access/navigation.ts';

const folder = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'src',
    'platform',
    'organization',
);

test('the three organization screens are app pages at the menu addresses', () => {
    const pages = [
        'legal-entities.page.tsx',
        'operating-units.page.tsx',
        'hierarchies.page.tsx',
    ].map((file) => readPage(join(folder, file)));
    expect(
        pages.map(({ path, layout, validatesSearch }) => ({
            path,
            layout,
            validatesSearch,
        })),
    ).toEqual([
        {
            path: '/sysadmin/organization/legal-entities',
            layout: 'app',
            validatesSearch: true,
        },
        {
            path: '/sysadmin/organization/operating-units',
            layout: 'app',
            validatesSearch: true,
        },
        {
            path: '/sysadmin/organization/hierarchies',
            layout: 'app',
            validatesSearch: true,
        },
    ]);
    const menu = (id: string) =>
        sysAdminArea.groups
            .find((group) => group.id === id)
            ?.items.map((item) => [item.href, item.permission]);
    expect(menu('organization')).toEqual(
        pages.map((page) => [page.path, 'core.organization.read']),
    );
    // Nomor dokumen punya kelompok sendiri, karena kodenya di folder sendiri (src/foundation/number-sequence/).
    expect(menu('number-sequence')).toEqual([
        ['/sysadmin/number-sequences', 'core.number-sequence.read'],
    ]);
});
