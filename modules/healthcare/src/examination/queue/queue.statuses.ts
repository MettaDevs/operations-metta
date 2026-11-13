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

// Status asal yang boleh untuk setiap tindakan beserta status tujuannya. Lewati mengembalikan pasien ke antrean di
// belakang yang sedang menunggu. Tidak datang tidak dipilih Panggil berikutnya lagi, tetapi pasiennya tetap bisa
// dipanggil dari halaman pemeriksaan atau diperiksa langsung bila ia datang belakangan, sama dengan pasien menunggu.
// Panggil ulang juga boleh selama diperiksa tanpa mengubah status, seperti tombol Panggil sistem lama yang tetap tampil
// selama SedangPeriksa (poly/views/form/statuspasien/index.php).
const queueTransitions: Record<
    QueueAction,
    Partial<Record<DestinationStatus, DestinationStatus>>
> = {
    panggil: { menunggu: 'dipanggil', tidak_datang: 'dipanggil' },
    panggil_ulang: { dipanggil: 'dipanggil', diperiksa: 'diperiksa' },
    lewati: { dipanggil: 'menunggu' },
    tidak_datang: { dipanggil: 'tidak_datang' },
    mulai_periksa: {
        menunggu: 'diperiksa',
        dipanggil: 'diperiksa',
        tidak_datang: 'diperiksa',
    },
    selesai_periksa: { diperiksa: 'selesai' },
};

// Status sesudah tindakan, atau null bila tindakan itu tidak boleh dari status sekarang.
export function nextStatus(
    action: QueueAction,
    from: DestinationStatus,
): DestinationStatus | null {
    return queueTransitions[action][from] ?? null;
}

export const notStartedMessage =
    'Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !';

// Rekam medis bisa diubah sesudah Mulai periksa, dan tetap bisa diubah sesudah Selesai periksa seperti sistem lama yang
// mengganti Simpan menjadi Update (poly/views/form/statuspasien/index.php:282-294). Null berarti boleh; selain itu
// alasan penolakannya.
export function recordLockedMessage(status: DestinationStatus): string | null {
    switch (status) {
        case 'diperiksa':
        case 'selesai':
            return null;
        case 'menunggu':
        case 'dipanggil':
        case 'tidak_datang':
            return notStartedMessage;
        case 'batal':
            return refusedMessage(status);
        default: {
            const unknown: never = status;
            return unknown;
        }
    }
}

// Alasan tindakan ditolak di status ini, dalam kalimat untuk petugas.
export function refusedMessage(from: DestinationStatus): string {
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
