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

// Halaman di alamat ini milik entri menu `href` (tanpa search params): halamannya sendiri, atau halaman di bawahnya,
// misalnya `/healthcare/registration/visits/new` di bawah menu Kunjungan.
export function underMenu(href: string, pathname: string): boolean {
    const path = href.split('?')[0] ?? href;
    return pathname === path || pathname.startsWith(`${path}/`);
}

// Entri menu yang menyala untuk alamat ini: entri yang alamatnya persis sama (termasuk search params), kalau tidak entri
// terdalam yang memuat halaman ini. Dengan begitu `/healthcare/registration/visits/new` menyalakan Registrasi baru,
// bukan Daftar kunjungan, sedangkan halaman satu kunjungan tetap menyalakan Daftar kunjungan.
export function activeMenuHref(
    hrefs: readonly string[],
    url: string,
    pathname: string,
): string | undefined {
    if (hrefs.includes(url)) return url;
    let deepest: string | undefined;
    for (const href of hrefs)
        if (
            !href.includes('?') &&
            underMenu(href, pathname) &&
            href.length > (deepest?.length ?? 0)
        )
            deepest = href;
    return deepest;
}

// Area yang memuat halaman di alamat ini.
export function areaOf<T extends Area>(
    navigation: readonly T[],
    pathname: string,
): T | undefined {
    return navigation.find((area) =>
        area.groups.some((group) =>
            group.items.some((item) => underMenu(item.href, pathname)),
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
