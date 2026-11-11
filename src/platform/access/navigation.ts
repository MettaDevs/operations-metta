import { z } from 'zod';

// Menu Shell, mengikuti Shell CoreERP (keputusan pemilik produk, 11 November 2026). Paling atas rail ada katalog
// aplikasi: Sys Admin untuk halaman Core, dan satu aplikasi per module dengan nama dari baris `apps` module itu. Di
// bawahnya rail berisi grup menu aplikasi yang sedang dibuka, satu grup per folder fitur di kode, jadi pembaca menu dan
// pembaca kode memakai susunan yang sama; sidebar berisi halaman grup yang dipilih. Di kode dan di `/api/v1/shell`
// aplikasi itu disebut area. URL halaman berawalan area: `/sysadmin/<folder>/...` untuk Core, `/<module>/<folder>/...`
// untuk module.
//
// Setiap area dibuka dengan dashboard-nya sendiri sebagai grup pertama; tidak ada dashboard bersama. Dashboard tidak
// membawa permission dan tidak membuat areanya tampil: area hanya tampil bila anggota boleh membuka salah satu halaman
// lain di dalamnya. Entri yang membawa permission hanya tampil bagi anggota yang memegangnya, dan kelompok yang semua
// entrinya tersaring ikut hilang. Ini hanya penyaring tampilan: setiap route tetap memeriksa izinnya sendiri.
//
// Hanya halaman yang sudah ada di repo ini yang masuk menu; test memeriksa setiap href punya halaman. Kelompok menu
// module memakai bentuk yang sama, dibaca dari apps.navigation yang ditulis migration module-nya.
//
// Ikon area dan grup adalah nama ikon lucide (`heart-pulse`). Ikon area module datang dari `apps.icon`, ikon grupnya
// dari `icon` di setiap grup apps.navigation; keduanya ditulis migration module. Server meneruskan namanya apa adanya,
// dan Shell yang menerjemahkannya ke ikon dari daftar yang ia kenal, dengan ikon bawaan bila tidak dikenal
// (src/platform/shell/navigation-icons.ts).
export const navigationGroupSchema = z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
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
type NavigationAreaEntry = {
    id: string;
    label: string;
    icon: string | null;
    groups: NavigationGroupEntry[];
};

// Halaman Core. Satu kelompok per folder kemampuan di src/platform/ dan src/foundation/.
export const sysAdminArea: NavigationAreaEntry = {
    id: 'sysadmin',
    label: 'Sys Admin',
    icon: 'settings',
    groups: [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: 'layout-dashboard',
            items: [
                {
                    id: 'dashboard',
                    label: 'Dashboard',
                    href: '/sysadmin/dashboard',
                },
            ],
        },
        {
            id: 'organization',
            label: 'Organisasi',
            icon: 'building-2',
            items: [
                {
                    id: 'legal-entities',
                    label: 'Perusahaan',
                    href: '/sysadmin/organization/legal-entities',
                    permission: 'core.organization.read',
                },
                {
                    id: 'operating-units',
                    label: 'Operating unit',
                    href: '/sysadmin/organization/operating-units',
                    permission: 'core.organization.read',
                },
                {
                    id: 'hierarchies',
                    label: 'Hierarki organisasi',
                    href: '/sysadmin/organization/hierarchies',
                    permission: 'core.organization.read',
                },
            ],
        },
        {
            id: 'address-book',
            label: 'Buku alamat',
            icon: 'contact',
            items: [
                {
                    id: 'parties',
                    label: 'Pihak',
                    href: '/sysadmin/address-book/parties',
                    permission: 'core.organization.read',
                },
                {
                    id: 'occupations',
                    label: 'Pekerjaan',
                    href: '/sysadmin/address-book/occupations',
                    permission: 'core.organization.read',
                },
                {
                    id: 'duplicate-check',
                    label: 'Cek data ganda',
                    href: '/sysadmin/address-book/duplicate-check',
                    permission: 'core.organization.read',
                },
            ],
        },
        {
            id: 'access',
            label: 'Akses',
            icon: 'shield-check',
            items: [
                {
                    id: 'staff',
                    label: 'Staf',
                    href: '/sysadmin/access/staff',
                    permission: 'core.access.read',
                },
                {
                    id: 'roles',
                    label: 'Role',
                    href: '/sysadmin/access/roles',
                    permission: 'core.access.read',
                },
                {
                    id: 'security-configuration',
                    label: 'Susun role',
                    href: '/sysadmin/access/security-configuration',
                    permission: 'core.access.read',
                },
            ],
        },
        {
            id: 'geography',
            label: 'Wilayah',
            icon: 'map',
            items: [
                {
                    id: 'address-setup',
                    label: 'Pengaturan',
                    href: '/sysadmin/geography/address-setup',
                    permission: 'core.reference-data.read',
                },
            ],
        },
        {
            id: 'number-sequence',
            label: 'Nomor dokumen',
            icon: 'hash',
            items: [
                {
                    id: 'number-sequences',
                    label: 'Nomor dokumen',
                    href: '/sysadmin/number-sequences',
                    permission: 'core.number-sequence.read',
                },
            ],
        },
    ],
};

export type NavigationItem = { id: string; label: string; href: string };
export type NavigationGroup = {
    id: string;
    label: string;
    icon: string | null;
    items: NavigationItem[];
};
export type NavigationArea = NavigationItem & {
    icon: string | null;
    groups: NavigationGroup[];
};

// Tautan area menuju halaman pertama yang tersisa, yaitu dashboard area, supaya tidak pernah menunjuk halaman yang
// tersaring. Tautan itu juga halaman awal pengguna bila area ini yang dipilih (src/platform/shell/home.ts).
export function visibleNavigation(
    areas: NavigationAreaEntry[],
    permissions: Set<string>,
): NavigationArea[] {
    return areas.flatMap((area) => {
        const opensAPage = area.groups.some((group) =>
            group.items.some(
                (item) =>
                    item.permission !== undefined &&
                    permissions.has(item.permission),
            ),
        );
        if (!opensAPage) return [];
        const groups = area.groups.flatMap((group) => {
            const items = group.items
                .filter(
                    (item) =>
                        item.permission === undefined ||
                        permissions.has(item.permission),
                )
                .map(({ id, label, href }) => ({ id, label, href }));
            return items.length
                ? [
                      {
                          id: group.id,
                          label: group.label,
                          icon: group.icon ?? null,
                          items,
                      },
                  ]
                : [];
        });
        const first = groups[0]?.items[0];
        return first
            ? [
                  {
                      id: area.id,
                      label: area.label,
                      icon: area.icon,
                      href: first.href,
                      groups,
                  },
              ]
            : [];
    });
}
