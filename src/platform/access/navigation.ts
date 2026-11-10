import { z } from 'zod';

// Menu Core di Shell, sama dengan useShellNavigation CoreERP: kelompok di rail kiri dan halaman di dalamnya. Entri
// yang membawa permission hanya tampil bagi anggota yang memegangnya, dan kelompok yang semua entrinya tersaring
// ikut hilang. Ini hanya penyaring tampilan: setiap route tetap memeriksa izinnya sendiri.
//
// Hanya halaman yang sudah ada di repo ini yang masuk menu; test memeriksa setiap href punya halaman.
// Menu module memakai bentuk yang sama, dibaca dari apps.navigation.
export const navigationGroupSchema = z.object({
    id: z.string(),
    label: z.string(),
    items: z.array(
        z.object({
            id: z.string(),
            label: z.string(),
            href: z.string(),
            permission: z.string().optional(),
        }),
    ),
});
type NavigationGroupEntry = z.infer<typeof navigationGroupSchema>;

export const coreNavigation: NavigationGroupEntry[] = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        items: [{ id: 'dashboard', label: 'Ringkasan', href: '/dashboard' }],
    },
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
                id: 'operating-units',
                label: 'Operating unit',
                href: '/settings/operating-units',
                permission: 'core.organization.read',
            },
            {
                id: 'organization-hierarchies',
                label: 'Hierarki organisasi',
                href: '/settings/organization-hierarchies',
                permission: 'core.organization.read',
            },
            {
                id: 'number-sequences',
                label: 'Nomor dokumen',
                href: '/settings/number-sequences',
                permission: 'core.number-sequence.read',
            },
        ],
    },
    {
        id: 'address-book',
        label: 'Buku alamat',
        items: [
            {
                id: 'parties',
                label: 'Pihak',
                href: '/settings/global-address-book',
                permission: 'core.organization.read',
            },
            {
                id: 'occupations',
                label: 'Pekerjaan',
                href: '/settings/occupations',
                permission: 'core.organization.read',
            },
            {
                id: 'party-duplicate-check',
                label: 'Cek data ganda',
                href: '/settings/party-duplicate-check',
                permission: 'core.organization.read',
            },
        ],
    },
    {
        id: 'access',
        label: 'Akses',
        items: [
            {
                id: 'staff-access',
                label: 'Staf',
                href: '/settings/access',
                permission: 'core.access.read',
            },
            {
                id: 'roles',
                label: 'Role',
                href: '/settings/roles',
                permission: 'core.access.read',
            },
            {
                id: 'security-configuration',
                label: 'Susun role',
                href: '/settings/security-configuration',
                permission: 'core.access.read',
            },
        ],
    },
    {
        id: 'address-setup',
        label: 'Setup alamat',
        items: [
            {
                id: 'address-setup',
                label: 'Pengaturan',
                href: '/settings/address-setup',
                permission: 'core.reference-data.read',
            },
        ],
    },
];

export type NavigationItem = { id: string; label: string; href: string };
export type NavigationGroup = NavigationItem & { items: NavigationItem[] };

// Tautan kelompok menuju halaman pertama yang tersisa, supaya tidak pernah menunjuk halaman yang tersaring.
export function visibleNavigation(
    groups: NavigationGroupEntry[],
    permissions: Set<string>,
): NavigationGroup[] {
    return groups.flatMap((group) => {
        const items = group.items
            .filter(
                (item) =>
                    item.permission === undefined ||
                    permissions.has(item.permission),
            )
            .map(({ id, label, href }) => ({ id, label, href }));
        const first = items[0];
        return first
            ? [{ id: group.id, label: group.label, href: first.href, items }]
            : [];
    });
}
