import {
    Boxes,
    Building2,
    Contact,
    Folder,
    Hash,
    LayoutDashboard,
    Map as MapIcon,
    Settings,
    ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Ikon aplikasi di katalog. Baris `apps` belum punya kolom ikon, dan Core tidak menulis nama module mana pun, jadi
// setiap module memakai ikon bawaan yang sama sampai module bisa menyatakan ikonnya sendiri.
export function productIcon(productId: string): LucideIcon {
    return productId === 'sysadmin' ? Settings : Boxes;
}

// Ikon grup menu di rail, dipilih dari id grup (nama folder fiturnya). Grup Core punya ikon sendiri; grup module
// memakai ikon umum, kecuali Dashboard yang ada di setiap aplikasi.
const groupIcons: Record<string, LucideIcon> = {
    dashboard: LayoutDashboard,
    organization: Building2,
    'address-book': Contact,
    access: ShieldCheck,
    geography: MapIcon,
    'number-sequence': Hash,
};

export function navigationIcon(groupId: string): LucideIcon {
    return groupIcons[groupId] ?? Folder;
}
