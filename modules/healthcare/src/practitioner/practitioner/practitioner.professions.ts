// Katalog profesi tenaga kesehatan. Kodenya data yang disimpan di sim_m_nakes.profesi (ditetapkan pemilik produk),
// labelnya teks layar. Profesi baru cukup ditambahkan di sini.
export const practitionerProfessions = [
    { code: 'dokter', label: 'Dokter' },
    { code: 'dokter_gigi', label: 'Dokter gigi' },
    { code: 'bidan', label: 'Bidan' },
    { code: 'perawat', label: 'Perawat' },
    { code: 'apoteker', label: 'Apoteker' },
    { code: 'analis', label: 'Analis' },
    { code: 'lainnya', label: 'Lainnya' },
] as const;
export type PractitionerProfession =
    (typeof practitionerProfessions)[number]['code'];

export function isPractitionerProfession(
    value: string,
): value is PractitionerProfession {
    return practitionerProfessions.some(
        (profession) => profession.code === value,
    );
}

export function professionLabel(code: string): string {
    return (
        practitionerProfessions.find((profession) => profession.code === code)
            ?.label ?? code
    );
}
