import { expect, test } from 'bun:test';
import { pageFiles, readPage } from '../../../scripts/generate-client.ts';
import {
    sysAdminArea,
    visibleNavigation,
} from '../../../src/platform/access/navigation.ts';

const areas = [
    {
        id: 'sysadmin',
        label: 'Sys Admin',
        icon: 'settings',
        groups: [
            {
                id: 'organization',
                label: 'Organisasi',
                icon: 'building-2',
                items: [
                    {
                        id: 'legal-entities',
                        label: 'Legal entity',
                        href: '/sysadmin/organization/legal-entities',
                        permission: 'core.organization.read',
                    },
                    {
                        id: 'hierarchies',
                        label: 'Hierarki organisasi',
                        href: '/sysadmin/organization/hierarchies',
                        permission: 'core.organization.update',
                    },
                ],
            },
            {
                id: 'access',
                label: 'Akses',
                items: [
                    {
                        id: 'staff',
                        label: 'Staf',
                        href: '/sysadmin/access/staff',
                        permission: 'core.access.read',
                    },
                ],
            },
        ],
    },
    {
        id: 'clinic',
        label: 'Area module',
        icon: null,
        groups: [
            {
                id: 'dashboard',
                label: 'Dashboard',
                items: [
                    {
                        id: 'dashboard',
                        label: 'Dashboard',
                        href: '/clinic/dashboard',
                    },
                ],
            },
            {
                id: 'patient',
                label: 'Pasien',
                items: [
                    {
                        id: 'patients',
                        label: 'Pasien',
                        href: '/clinic/patient/patients',
                        permission: 'clinic.patient.read',
                    },
                ],
            },
        ],
    },
];

test('entries the member lacks the permission for are hidden, and an emptied group or area goes with them', () => {
    expect(
        visibleNavigation(areas, new Set(['core.organization.read'])),
    ).toEqual([
        {
            id: 'sysadmin',
            label: 'Sys Admin',
            icon: 'settings',
            href: '/sysadmin/organization/legal-entities',
            groups: [
                {
                    id: 'organization',
                    label: 'Organisasi',
                    icon: 'building-2',
                    items: [
                        {
                            id: 'legal-entities',
                            label: 'Legal entity',
                            href: '/sysadmin/organization/legal-entities',
                            section: null,
                        },
                    ],
                },
            ],
        },
    ]);
    // Area hanya tampil bila anggota boleh membuka salah satu halamannya; dashboard tanpa permission tidak cukup.
    // Dashboard menjadi halaman pertama, dan tautan area menujunya.
    expect(
        visibleNavigation(areas, new Set(['clinic.patient.read'])).map(
            (area) => [area.id, area.href],
        ),
    ).toEqual([['clinic', '/clinic/dashboard']]);
    expect(visibleNavigation(areas, new Set())).toEqual([]);
    // Ikon area dan grup diteruskan dari datanya; grup tanpa ikon mendapat null, dan Shell memakai ikon bawaan.
    const clinic = visibleNavigation(
        areas,
        new Set(['clinic.patient.read']),
    )[0];
    expect(clinic?.icon).toBeNull();
    expect(clinic?.groups.map((group) => group.icon)).toEqual([null, null]);
    // Tautan area menuju halaman pertama yang masih tampil, juga bila kelompok pertamanya tersaring habis.
    expect(
        visibleNavigation(areas, new Set(['core.access.read']))[0]?.href,
    ).toBe('/sysadmin/access/staff');
    expect(
        visibleNavigation(areas, new Set(['core.organization.update']))[0]
            ?.href,
    ).toBe('/sysadmin/organization/hierarchies');
});

test('an entry carries its sidebar section title, and the title goes with the entry when a sibling is filtered out', () => {
    const setup = [
        {
            id: 'clinic',
            label: 'Klinik',
            icon: null,
            groups: [
                {
                    id: 'setup',
                    label: 'Setup',
                    items: [
                        {
                            id: 'patient-types',
                            label: 'Tipe pasien',
                            href: '/clinic/coverage/patient-types',
                            section: 'Penjaminan',
                            permission: 'clinic.patient-type.read',
                        },
                        {
                            id: 'guarantors',
                            label: 'Penjamin',
                            href: '/clinic/coverage/guarantors',
                            section: 'Penjaminan',
                            permission: 'clinic.guarantor.read',
                        },
                    ],
                },
            ],
        },
    ];
    expect(
        visibleNavigation(setup, new Set(['clinic.guarantor.read']))[0]
            ?.groups[0]?.items,
    ).toEqual([
        {
            id: 'guarantors',
            label: 'Penjamin',
            href: '/clinic/coverage/guarantors',
            section: 'Penjaminan',
        },
    ]);
});

test('every menu entry opens a page that exists, under the area prefix', () => {
    const paths = new Set(pageFiles().map((file) => readPage(file).path));
    for (const group of sysAdminArea.groups)
        for (const item of group.items) {
            expect(paths.has(item.href.split('?')[0]!)).toBe(true);
            expect(item.href.startsWith('/sysadmin/')).toBe(true);
        }
});

test('the Sys Admin sidebar groups follow the Core feature folders that hold their pages', () => {
    const pages = new Map(
        pageFiles().map((file) => [readPage(file).path, file]),
    );
    for (const group of sysAdminArea.groups)
        for (const item of group.items) {
            const file = pages.get(item.href)?.split(/[\\/]/) ?? [];
            // src/platform/<folder>/... atau src/foundation/<folder>/...
            expect(file[file.indexOf('src') + 2]).toBe(group.id);
        }
});
