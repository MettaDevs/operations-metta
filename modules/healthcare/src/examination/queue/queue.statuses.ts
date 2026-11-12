// Status tujuan kunjungan di antrean poli dan tindakan yang memindahkannya. Kodenya disimpan di
// sim_tr_registrasi_tujuan.status; tindakannya dicatat di sim_tr_antrean_panggilan.aksi.
export const destinationStatuses = [
    'menunggu',
    'dipanggil',
    'diperiksa',
    'selesai',
    'tidak_datang',
    'batal',
] as const;
export type DestinationStatus = (typeof destinationStatuses)[number];

export function isDestinationStatus(value: string): value is DestinationStatus {
    return destinationStatuses.some((status) => status === value);
}

export const queueActions = [
    'panggil',
    'panggil_ulang',
    'lewati',
    'tidak_datang',
    'mulai_periksa',
    'selesai_periksa',
] as const;
export type QueueAction = (typeof queueActions)[number];

// Lewati mengembalikan pasien ke antrean di belakang yang sedang menunggu. Tidak datang tidak dipanggil lagi, tetapi
// pemeriksaannya tetap bisa dimulai dari daftar bila pasien datang belakangan, sama dengan pasien menunggu yang
// diperiksa langsung tanpa dipanggil.
export const queueTransitions: Record<
    QueueAction,
    { from: readonly DestinationStatus[]; to: DestinationStatus }
> = {
    panggil: { from: ['menunggu'], to: 'dipanggil' },
    panggil_ulang: { from: ['dipanggil'], to: 'dipanggil' },
    lewati: { from: ['dipanggil'], to: 'menunggu' },
    tidak_datang: { from: ['dipanggil'], to: 'tidak_datang' },
    mulai_periksa: {
        from: ['menunggu', 'dipanggil', 'tidak_datang'],
        to: 'diperiksa',
    },
    selesai_periksa: { from: ['diperiksa'], to: 'selesai' },
};

// Alasan tindakan ditolak untuk status sekarang, dalam kalimat untuk petugas, atau null bila boleh.
export function refusedAction(
    action: QueueAction,
    from: DestinationStatus,
): string | null {
    if (queueTransitions[action].from.includes(from)) return null;
    switch (from) {
        case 'menunggu':
            return 'Pasien ini belum dipanggil.';
        case 'dipanggil':
            return 'Pasien ini sedang dipanggil.';
        case 'diperiksa':
            return 'Pasien ini sedang diperiksa.';
        case 'selesai':
            return 'Pemeriksaan pasien ini sudah selesai.';
        case 'tidak_datang':
            return 'Pasien ini sudah ditandai tidak datang.';
        case 'batal':
            return 'Kunjungan ini sudah dibatalkan.';
        default: {
            const unknown: never = from;
            return unknown;
        }
    }
}
