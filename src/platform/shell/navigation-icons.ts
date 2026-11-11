import {
    Activity,
    Baby,
    Bed,
    BookOpen,
    Boxes,
    Briefcase,
    Building2,
    Calendar,
    ClipboardList,
    Contact,
    CreditCard,
    FileText,
    Folder,
    Hash,
    HeartPulse,
    Hospital,
    LayoutDashboard,
    Map as MapIcon,
    Package,
    Pill,
    Receipt,
    Settings,
    ShieldCheck,
    ShieldPlus,
    Stethoscope,
    Syringe,
    Truck,
    UserRound,
    Users,
    Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Ikon yang dikenal Shell, dengan nama ikon lucide dalam ejaan resminya (https://lucide.dev/icons). Nama ikon aplikasi
// datang dari `apps.icon` dan nama ikon grup dari `icon` di apps.navigation, keduanya ditulis migration module; ikon
// Sys Admin dan grupnya ditulis di src/platform/access/navigation.ts. Hanya ikon di daftar ini yang ikut ke build
// peramban, jadi module yang butuh ikon lain menambahkannya di sini. Nama yang tidak ada di daftar memakai ikon bawaan.
const knownIcons = new Map<string, LucideIcon>([
    ['activity', Activity],
    ['baby', Baby],
    ['bed', Bed],
    ['book-open', BookOpen],
    ['boxes', Boxes],
    ['briefcase', Briefcase],
    ['building-2', Building2],
    ['calendar', Calendar],
    ['clipboard-list', ClipboardList],
    ['contact', Contact],
    ['credit-card', CreditCard],
    ['file-text', FileText],
    ['folder', Folder],
    ['hash', Hash],
    ['heart-pulse', HeartPulse],
    ['hospital', Hospital],
    ['layout-dashboard', LayoutDashboard],
    ['map', MapIcon],
    ['package', Package],
    ['pill', Pill],
    ['receipt', Receipt],
    ['settings', Settings],
    ['shield-check', ShieldCheck],
    ['shield-plus', ShieldPlus],
    ['stethoscope', Stethoscope],
    ['syringe', Syringe],
    ['truck', Truck],
    ['user-round', UserRound],
    ['users', Users],
    ['wallet', Wallet],
]);

function knownIcon(name: string | null): LucideIcon | undefined {
    return name === null ? undefined : knownIcons.get(name);
}

// Ikon aplikasi di katalog dan di pencarian halaman. Bawaannya ikon module umum.
export function productIcon(name: string | null): LucideIcon {
    return knownIcon(name) ?? Boxes;
}

// Ikon grup menu di rail. Bawaannya ikon folder, karena setiap grup adalah satu folder fitur di kode.
export function navigationIcon(name: string | null): LucideIcon {
    return knownIcon(name) ?? Folder;
}
