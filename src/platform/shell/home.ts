// Halaman awal mengikuti pengguna, pola Role Center Business Central: tidak ada dashboard bersama. Pengguna dibawa ke
// area terakhir yang ia buka bila menu masih memuatnya, kalau tidak ke area pertama yang boleh ia buka, lalu ke
// halaman pertama di area itu (tautan area sudah menunjuk halaman pertama yang tersisa setelah disaring izin).
//
// "Area terakhir" disimpan di localStorage peramban, satu kunci per pengguna. Origin sudah satu per lingkungan tenant,
// jadi kuncinya tidak bertabrakan antar-klinik. Pilihan ini hanya kenyamanan: hilang di peramban lain atau bila
// penyimpanan dibersihkan, dan saat itu pengguna mendapat area pertama yang boleh ia buka.
type Area = {
    id: string;
    href: string;
    groups: { items: { href: string }[] }[];
};

export function homePath(
    navigation: readonly Area[],
    lastAreaId: string | null,
): string | null {
    return (
        (navigation.find((area) => area.id === lastAreaId) ?? navigation[0])
            ?.href ?? null
    );
}

// Area yang memuat halaman di alamat ini, dicocokkan dengan href menu tanpa search params.
export function areaOf<T extends Area>(
    navigation: readonly T[],
    pathname: string,
): T | undefined {
    return navigation.find((area) =>
        area.groups.some((group) =>
            group.items.some((item) => item.href.split('?')[0] === pathname),
        ),
    );
}

const lastAreaKey = (userId: string) => `last-area:${userId}`;

export function readLastArea(userId: string): string | null {
    try {
        return localStorage.getItem(lastAreaKey(userId));
    } catch {
        // Penyimpanan peramban diblokir: halaman awal jatuh ke area pertama.
        return null;
    }
}

export function rememberArea(userId: string, areaId: string): void {
    try {
        localStorage.setItem(lastAreaKey(userId), areaId);
    } catch {
        // Penyimpanan peramban diblokir: area terakhir tidak diingat.
    }
}
