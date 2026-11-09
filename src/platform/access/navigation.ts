// Menu Core di Shell, sama dengan useShellNavigation CoreERP: kelompok di rail kiri dan halaman di dalamnya. Entri
// yang membawa permission hanya tampil bagi anggota yang memegangnya, dan kelompok yang semua entrinya tersaring
// ikut hilang. Ini hanya penyaring tampilan: setiap route tetap memeriksa izinnya sendiri.
//
// Hanya halaman yang sudah ada di repo ini yang masuk menu; test memeriksa setiap href punya halaman.
type NavigationEntry = {
    id: string;
    label: string;
    href: string;
    permission?: string;
};
type NavigationGroupEntry = {
    id: string;
    label: string;
    items: NavigationEntry[];
};

export const coreNavigation: NavigationGroupEntry[] = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        items: [{ id: 'dashboard', label: 'Ringkasan', href: '/dashboard' }],
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
