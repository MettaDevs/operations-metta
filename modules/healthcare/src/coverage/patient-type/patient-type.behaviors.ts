// Katalog perilaku tipe pasien. Setiap perilaku diimplementasikan sekali di kode dan dinyalakan per tipe pasien lewat
// sim_m_tipe_pasien_perilaku, jadi kode tidak pernah mencocokkan nama atau id tipe pasien. Isinya hanya perilaku yang
// dipakai form pasien sistem lama (common/views/patients/form.php): pilihan Perusahaan (CustomerKerjasamaID) dan
// No. asuransi (NoAnggota) yang muncul untuk tipe berpenjamin, bagian `.Asuransi` yang di form lama dinyalakan
// lewat id tipe yang ditulis mati. settles_automatically melunasi tagihan kunjungan dengan jenis bayar otomatis tipe itu
// begitu kunjungan selesai, padanan bayar otomatis BPJS sistem lama yang ditulis mati untuk KerjasamaID 9.
export const patientTypeBehaviors = [
    'requires_guarantor',
    'requires_card_number',
    'settles_automatically',
] as const;
export type PatientTypeBehavior = (typeof patientTypeBehaviors)[number];

export function isPatientTypeBehavior(
    value: string,
): value is PatientTypeBehavior {
    return patientTypeBehaviors.some((behavior) => behavior === value);
}
