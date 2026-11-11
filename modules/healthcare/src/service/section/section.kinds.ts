// Katalog jenis section beserta labelnya di layar. Kodenya disimpan di sim_m_section.jenis, jadi kode yang sudah dipakai
// tidak diganti. Jenis baru cukup ditambahkan di sini; tabel tidak berubah.
export const sectionKinds = {
    rawat_jalan: 'Rawat jalan',
    gawat_darurat: 'Gawat darurat',
    rawat_inap: 'Rawat inap',
    penunjang: 'Penunjang',
    farmasi: 'Farmasi',
    kasir: 'Kasir',
} as const;
export type SectionKind = keyof typeof sectionKinds;

export function isSectionKind(value: string): value is SectionKind {
    return Object.hasOwn(sectionKinds, value);
}
