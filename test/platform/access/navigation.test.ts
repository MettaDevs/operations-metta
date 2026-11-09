import { expect, test } from 'bun:test';
import { pageFiles, readPage } from '../../../scripts/generate-client.ts';
import {
    coreNavigation,
    visibleNavigation,
} from '../../../src/platform/access/navigation.ts';

test('entries the member lacks the permission for are hidden, and an emptied group goes with them', () => {
    const groups = [
        {
            id: 'organization',
            label: 'Organisasi',
            items: [
                {
                    id: 'legal-entities',
                    label: 'Perusahaan',
                    href: '/settings/legal-entities',
                    permission: 'core.organization.read',
                },
                {
                    id: 'hierarchies',
                    label: 'Hierarki organisasi',
                    href: '/settings/organization-hierarchies',
                    permission: 'core.organization.update',
                },
            ],
        },
        {
            id: 'access',
            label: 'Identity & access',
            items: [
                {
                    id: 'members',
                    label: 'Anggota',
                    href: '/settings/access',
                    permission: 'core.access.read',
                },
            ],
        },
        {
            id: 'dashboard',
            label: 'Dashboard',
            items: [
                { id: 'dashboard', label: 'Ringkasan', href: '/dashboard' },
            ],
        },
    ];
    expect(
        visibleNavigation(groups, new Set(['core.organization.read'])),
    ).toEqual([
        {
            id: 'organization',
            label: 'Organisasi',
            href: '/settings/legal-entities',
            items: [
                {
                    id: 'legal-entities',
                    label: 'Perusahaan',
                    href: '/settings/legal-entities',
                },
            ],
        },
        {
            id: 'dashboard',
            label: 'Dashboard',
            href: '/dashboard',
            items: [
                { id: 'dashboard', label: 'Ringkasan', href: '/dashboard' },
            ],
        },
    ]);
    // Tautan kelompok menuju halaman pertama yang masih tampil.
    expect(
        visibleNavigation(groups, new Set(['core.organization.update']))[0]
            ?.href,
    ).toBe('/settings/organization-hierarchies');
});

test('every menu entry opens a page that exists', () => {
    const paths = new Set(pageFiles().map((file) => readPage(file).path));
    for (const group of coreNavigation)
        for (const item of group.items)
            expect(paths.has(item.href.split('?')[0]!)).toBe(true);
});
