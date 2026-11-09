import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readPage } from '../../../scripts/generate-client.ts';
import { coreNavigation } from '../../../src/platform/access/navigation.ts';

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
            path: '/settings/legal-entities',
            layout: 'app',
            validatesSearch: true,
        },
        {
            path: '/settings/operating-units',
            layout: 'app',
            validatesSearch: true,
        },
        {
            path: '/settings/organization-hierarchies',
            layout: 'app',
            validatesSearch: true,
        },
    ]);
    const menu = coreNavigation.find((group) => group.id === 'organization');
    expect(menu?.items.map((item) => [item.href, item.permission])).toEqual(
        pages.map((page) => [page.path, 'core.organization.read']),
    );
});
