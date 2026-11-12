// Status kunjungan dan perpindahannya. Kodenya disimpan di sim_tr_registrasi.status. Pendaftaran menulis terdaftar;
// antrean poli memindahkannya ke diperiksa lalu selesai. Batal hanya dari terdaftar.
export const visitStatuses = [
    'terdaftar',
    'diperiksa',
    'selesai',
    'batal',
] as const;
export type VisitStatus = (typeof visitStatuses)[number];

const transitions: Record<VisitStatus, readonly VisitStatus[]> = {
    terdaftar: ['diperiksa', 'batal'],
    diperiksa: ['selesai'],
    selesai: [],
    batal: [],
};

export function isVisitStatus(value: string): value is VisitStatus {
    return visitStatuses.some((status) => status === value);
}

// Alasan perpindahan ditolak, dalam kalimat untuk petugas, atau null bila boleh.
export function refusedTransition(
    from: VisitStatus,
    to: VisitStatus,
): string | null {
    if (transitions[from].includes(to)) return null;
    switch (from) {
        case 'diperiksa':
        case 'selesai':
            // Pesan sistem lama persis (registrations, batal registrasi).
            return 'Gagal Batal Registrasi! Pasien dengan Registrasi ini sudah dilakukan Pemeriksaan.';
        case 'batal':
            return 'Kunjungan ini sudah dibatalkan.';
        case 'terdaftar':
            return 'Kunjungan ini belum dapat dipindahkan ke status itu.';
        default: {
            const unknown: never = from;
            return unknown;
        }
    }
}

// Status kunjungan sakit atau sehat, disimpan apa adanya di sim_tr_registrasi.status_kunjungan.
export const visitConditions = ['sakit', 'sehat'] as const;
export type VisitCondition = (typeof visitConditions)[number];
export function isVisitCondition(value: string): value is VisitCondition {
    return visitConditions.some((condition) => condition === value);
}
