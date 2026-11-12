// Katalog perilaku status pasien. Pilihan status adalah baris sim_m_status_pulang per tenant; perilaku menentukan isian
// tambahan yang dibuka status itu, seperti kotak opsi di bawah radio Status Pasien sistem lama
// (statuspasien/index.php). Kode tidak pernah mencocokkan kode atau nama status. Status tanpa perilaku tidak membuka
// isian apa pun. Berkas ini tidak meng-import apa pun, karena dibaca server dan layar.
export const dischargeBehaviors = [
    'rawat_jalan',
    'rawat_inap',
    'rujuk_internal',
    'rujuk_eksternal',
    'meninggal',
] as const;
export type DischargeBehavior = (typeof dischargeBehaviors)[number];

export function isDischargeBehavior(value: string): value is DischargeBehavior {
    return dischargeBehaviors.some((behavior) => behavior === value);
}

// Pesan sistem lama persis (statuspasien_helper.php).
export const duplicateReferralMessage =
    'Sudah Terdapat Data Pada Poli yang Sama.';
export const referrerUnfinishedMessage = (section: string) =>
    `Tidak Dapat Memulai Pemeriksaan Karena Pemeriksaan Di ${section} Belum Selesai.`;
