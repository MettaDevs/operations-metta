import { Database, LayoutDashboard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Ikon kelompok menu Core di rail, dipilih dari id kelompok yang dikirim `/api/v1/shell`. Kelompok tanpa ikon sendiri
// memakai ikon umum, sama dengan rail module di CoreERP.
const icons: Record<string, LucideIcon> = {
    dashboard: LayoutDashboard,
};

export function navigationIcon(groupId: string): LucideIcon {
    return icons[groupId] ?? Database;
}
