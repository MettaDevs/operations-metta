// Katalog cara section membagi nomor antrean, beserta labelnya di layar. Kodenya disimpan di
// sim_m_section.mode_antrean. Nomor antrean mulai lagi setiap hari pada kedua mode.
export const queueModes = {
    // Satu nomor per section per hari dipakai semua ruangan; ruangan terikat saat ruangan memanggil pasien.
    bersama: 'Satu antrean untuk semua ruangan',
    // Satu nomor per sesi praktik atau jadwal dokter.
    per_jadwal: 'Antrean per jadwal praktik',
} as const;
export type QueueMode = keyof typeof queueModes;
export const defaultQueueMode: QueueMode = 'bersama';

export function isQueueMode(value: string): value is QueueMode {
    return Object.hasOwn(queueModes, value);
}
